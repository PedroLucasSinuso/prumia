package invoice

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/PedroLucasSinuso/prumia/api/internal/boleto"
	"github.com/PedroLucasSinuso/prumia/api/internal/category"
	"github.com/PedroLucasSinuso/prumia/api/internal/payee"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var (
	ErrNotFound     = errors.New("invoice não encontrada")
	ErrAlreadyPaid  = errors.New("esta invoice já está paga")
	ErrNotPaid      = errors.New("esta invoice não está paga")
	ErrCategoryGone = errors.New("a categoria desta invoice foi excluída")
	ErrNotDeleted   = errors.New("a invoice não está excluída")
	// ErrSeriesChanged: o Desfazer em lote não se aplica porque a recorrência mudou depois da exclusão.
	ErrSeriesChanged = errors.New("a conta fixa mudou depois desta exclusão; restaure uma a uma")
)

// MaxAmount (exportado: compras e recorrências usam o mesmo limite) evita valores absurdos (e estouro de int64 em somas): R$ 10 bilhões.
const MaxAmount money.Cents = 1_000_000_000_000

type Service struct {
	db    *gorm.DB
	today func() caldate.Date // "hoje" no fuso da aplicação; injetável nos testes
}

func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today}
}

func (s *Service) view(i Invoice) View { return View{Invoice: i, Status: statusOf(i, s.today())} }

// Views calcula o status e, para parcelas, busca o total de parcelas da compra (uma consulta só para a lista
// inteira, evitando N+1). É o que preenche `series.installmentsCount` na resposta.
func (s *Service) Views(ctx context.Context, householdID uuid.UUID, rows []Invoice) ([]View, error) {
	today := s.today()
	counts := map[uuid.UUID]int{}
	var ids []uuid.UUID
	for _, r := range rows {
		if r.PurchaseID != nil {
			if _, seen := counts[*r.PurchaseID]; !seen {
				counts[*r.PurchaseID] = 0
				ids = append(ids, *r.PurchaseID)
			}
		}
	}
	if len(ids) > 0 {
		var found []struct {
			ID                uuid.UUID
			InstallmentsCount int
		}
		// Table (e não Model) para não depender do pacote de compras; inclui compras excluídas de propósito:
		// a parcela restaurada continua sabendo "n de N".
		err := s.db.WithContext(ctx).Table("purchases").Select("id, installments_count").
			Where("household_id = ? AND id IN ?", householdID, ids).Scan(&found).Error
		if err != nil {
			return nil, fmt.Errorf("lendo total de parcelas: %w", err)
		}
		for _, f := range found {
			counts[f.ID] = f.InstallmentsCount
		}
	}
	boletos, err := s.boletosOf(ctx, householdID, rows)
	if err != nil {
		return nil, err
	}
	out := make([]View, len(rows))
	for i, r := range rows {
		out[i] = View{Invoice: r, Status: statusOf(r, today)}
		if b, ok := boletos[r.ID]; ok {
			b := b
			out[i].Boleto = &b
		}
		if r.PurchaseID != nil {
			if n := counts[*r.PurchaseID]; n > 0 {
				out[i].InstallmentsCount = &n
			}
		}
	}
	return out, nil
}

// boletosOf busca os boletos de todas as invoices da lista numa consulta só (sem N+1).
func (s *Service) boletosOf(ctx context.Context, householdID uuid.UUID, rows []Invoice) (map[uuid.UUID]Boleto, error) {
	ids := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}
	out := map[uuid.UUID]Boleto{}
	if len(ids) == 0 {
		return out, nil
	}
	var found []Boleto
	if err := s.db.WithContext(ctx).Where("household_id = ? AND invoice_id IN ?", householdID, ids).Find(&found).Error; err != nil {
		return nil, fmt.Errorf("lendo boletos: %w", err)
	}
	for _, b := range found {
		out[b.InvoiceID] = b
	}
	return out, nil
}

func (s *Service) viewOne(ctx context.Context, householdID uuid.UUID, i Invoice) (View, error) {
	vs, err := s.Views(ctx, householdID, []Invoice{i})
	if err != nil {
		return View{}, err
	}
	return vs[0], nil
}

// ---------------------------------------------------------------- validações

// CheckRefs confere que a categoria é da casa (e não está arquivada) e que o responsável é membro ativo.
func (s *Service) CheckRefs(ctx context.Context, householdID uuid.UUID, categoryID *uuid.UUID, responsible *uuid.UUID, v *validation.Collector) error {
	if categoryID != nil {
		var n int64
		err := s.db.WithContext(ctx).Model(&category.Category{}).
			Where("household_id = ? AND id = ? AND archived_at IS NULL", householdID, *categoryID).Count(&n).Error
		if err != nil {
			return err
		}
		if n == 0 {
			v.Add("categoryId", "categoria inválida ou arquivada")
		}
	}
	if responsible != nil {
		var n int64
		err := s.db.WithContext(ctx).Table("household_members").
			Where("household_id = ? AND user_id = ? AND left_at IS NULL", householdID, *responsible).Count(&n).Error
		if err != nil {
			return err
		}
		if n == 0 {
			v.Add("responsibleUserId", "o responsável deve ser membro da casa")
		}
	}
	return nil
}

// checkPayee exige favorecido da própria casa e não arquivado (nil = sem favorecido, vale).
func (s *Service) checkPayee(ctx context.Context, householdID uuid.UUID, id *uuid.UUID, v *validation.Collector) error {
	if id == nil {
		return nil
	}
	var n int64
	err := s.db.WithContext(ctx).Table("payees").
		Where("household_id = ? AND id = ? AND archived_at IS NULL AND deleted_at IS NULL", householdID, *id).Count(&n).Error
	if err != nil {
		return err
	}
	if n == 0 {
		v.Add("payeeId", "favorecido inválido ou arquivado")
	}
	return nil
}

func CheckDescription(d string, v *validation.Collector) string {
	d = strings.TrimSpace(d)
	if n := len([]rune(d)); n < 1 || n > 120 {
		v.Add("description", "informe uma descrição de 1 a 120 caracteres")
	}
	return d
}

func CheckAmount(a money.Cents, field string, v *validation.Collector) {
	if a <= 0 || a > MaxAmount {
		v.Add(field, "informe um valor maior que zero")
	}
}

func CheckNotes(n *string, v *validation.Collector) *string {
	if n == nil {
		return nil
	}
	t := strings.TrimSpace(*n)
	if len([]rune(t)) > 500 {
		v.Add("notes", "a observação pode ter até 500 caracteres")
	}
	if t == "" {
		return nil
	}
	return &t
}

func CheckCompetence(m caldate.Date, v *validation.Collector) {
	if m.IsZero() || !m.IsStartOfMonth() {
		v.Add("competenceMonth", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
}

// ---------------------------------------------------------------- criar

type CreateInput struct {
	CategoryID        uuid.UUID
	ResponsibleUserID *uuid.UUID
	PayeeID           *uuid.UUID
	// NewPayee cria o favorecido na mesma transação da conta. Não combina com PayeeID.
	NewPayee        *NewPayeeInput
	Description     string
	AmountCents     money.Cents
	DueDate         caldate.Date
	CompetenceMonth *caldate.Date // nil = mês do vencimento
	Notes           *string
	// Boleto opcional: a linha digitável é validada pelos dígitos verificadores; valor e vencimento do boleto vêm dela.
	Boleto *BoletoInput
}

// NewPayeeInput: nome (apelido) do favorecido a criar junto com a conta.
type NewPayeeInput struct{ Name string }

// BoletoInput é o que o cliente envia sobre o boleto. Só a linha é confiável (validada); o resto é descritivo.
type BoletoInput struct {
	DigitableLine   string
	BeneficiaryName *string
	// BeneficiaryCNPJ é descritivo (validado pelos dígitos verificadores): vira o CNPJ do favorecido criado ou escolhido.
	BeneficiaryCNPJ *string
}

func (s *Service) Create(ctx context.Context, householdID, userID uuid.UUID, in CreateInput) (View, error) {
	var v validation.Collector
	p, err := s.prepare(ctx, householdID, userID, in, &v)
	if err != nil {
		return View{}, err
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return p.write(ctx, tx, householdID, nil)
	})
	if err != nil {
		return View{}, err
	}
	out := s.view(p.inv)
	out.Boleto = p.bol
	return out, nil
}

// MaxBatch é o máximo de contas criadas de uma vez (tela "Importar").
const MaxBatch = 50

// CreateBatch cria várias invoices numa transação só: ou todas entram, ou nenhuma. Cada item é validado como no
// Create e os erros voltam com o índice ("items.3.amountCents"), para a tela marcar a linha certa.
// A mesma linha digitável em dois itens é recusada; newPayee com o mesmo nome em vários itens cria UM favorecido.
func (s *Service) CreateBatch(ctx context.Context, householdID, userID uuid.UUID, items []CreateInput) ([]View, error) {
	var v validation.Collector
	if len(items) < 1 || len(items) > MaxBatch {
		v.Add("items", fmt.Sprintf("envie de 1 a %d contas", MaxBatch))
		return nil, v.Err()
	}
	prepared := make([]prepared, len(items))
	lines := map[string]int{}
	for i, in := range items {
		var iv validation.Collector
		p, err := s.prepare(ctx, householdID, userID, in, &iv)
		if err != nil {
			return nil, err
		}
		prefix := fmt.Sprintf("items.%d.", i)
		if ierr := iv.Err(); ierr != nil {
			var ve *validation.Error
			if errors.As(ierr, &ve) {
				for f, msg := range ve.Fields {
					v.Add(prefix+f, msg)
				}
			}
		}
		if p.bol != nil {
			if first, seen := lines[p.bol.DigitableLine]; seen {
				v.Add(prefix+"boleto.digitableLine", fmt.Sprintf("o mesmo boleto já está na conta %d do lote", first+1))
			} else {
				lines[p.bol.DigitableLine] = i
			}
		}
		prepared[i] = p
	}
	if err := v.Err(); err != nil {
		return nil, err
	}
	created := map[string]uuid.UUID{} // nome do novo favorecido (sem caixa) -> id criado neste lote
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for i := range prepared {
			if err := prepared[i].write(ctx, tx, householdID, created); err != nil {
				// Validação de um favorecido novo também aponta o item.
				var ve *validation.Error
				if errors.As(err, &ve) {
					fields := map[string]string{}
					for f, msg := range ve.Fields {
						fields[fmt.Sprintf("items.%d.newPayee.%s", i, f)] = msg
					}
					return &validation.Error{Fields: fields}
				}
				return fmt.Errorf("conta %d do lote: %w", i+1, err)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]View, len(prepared))
	for i, p := range prepared {
		out[i] = s.view(p.inv)
		out[i].Boleto = p.bol
	}
	return out, nil
}

// prepared é uma invoice validada, pronta para gravar (a validação acontece fora da transação).
type prepared struct {
	in  CreateInput
	inv Invoice
	bol *Boleto
}

// prepare valida a entrada (os erros de campo vão para v) e monta a linha. O erro devolvido é só falha de banco.
func (s *Service) prepare(ctx context.Context, householdID, userID uuid.UUID, in CreateInput, v *validation.Collector) (prepared, error) {
	in.Description = CheckDescription(in.Description, v)
	CheckAmount(in.AmountCents, "amountCents", v)
	if in.DueDate.IsZero() {
		v.Add("dueDate", "informe a data de vencimento")
	}
	competence := in.DueDate.StartOfMonth()
	if in.CompetenceMonth != nil {
		competence = *in.CompetenceMonth
		CheckCompetence(competence, v)
	}
	in.Notes = CheckNotes(in.Notes, v)
	if err := s.CheckRefs(ctx, householdID, &in.CategoryID, in.ResponsibleUserID, v); err != nil {
		return prepared{}, err
	}
	if err := s.checkPayee(ctx, householdID, in.PayeeID, v); err != nil {
		return prepared{}, err
	}
	if in.NewPayee != nil && in.PayeeID != nil {
		v.Add("newPayee", "escolha um favorecido existente ou crie um novo, não os dois")
	}
	p := prepared{in: in, inv: Invoice{
		HouseholdID: householdID, CategoryID: in.CategoryID, ResponsibleUserID: in.ResponsibleUserID, PayeeID: in.PayeeID,
		Description: in.Description, AmountCents: in.AmountCents, DueDate: in.DueDate, CompetenceMonth: competence,
		Notes: in.Notes, CreatedBy: userID,
	}}
	if in.Boleto != nil {
		parsed, err := boleto.Parse(in.Boleto.DigitableLine, s.today().Time())
		if err != nil {
			v.Add("boleto.digitableLine", "linha digitável inválida: confira os números")
		} else {
			p.bol = boletoRow(parsed, in.Boleto.BeneficiaryName)
		}
	}
	return p, nil
}

// write grava a invoice (e o favorecido novo e o boleto) dentro da transação tx. created, se não for nil, reaproveita
// o favorecido novo de mesmo nome já criado no lote (sem ele, o 2º item daria "nome já existe" e o lote cairia).
func (p *prepared) write(ctx context.Context, tx *gorm.DB, householdID uuid.UUID, created map[string]uuid.UUID) error {
	in := p.in
	// CNPJ e razão social vêm do boleto lido; sem boleto (ou sem CNPJ válido) o favorecido nasce só com o nome.
	var boletoCNPJ, boletoName *string
	if in.Boleto != nil {
		boletoCNPJ, boletoName = in.Boleto.BeneficiaryCNPJ, in.Boleto.BeneficiaryName
	}
	payees := payee.NewService(tx) // com o tx: o favorecido só existe se a conta for gravada
	switch {
	case in.NewPayee != nil:
		key := strings.ToLower(strings.TrimSpace(in.NewPayee.Name))
		if id, ok := created[key]; ok && created != nil {
			p.inv.PayeeID = &id
			break
		}
		np, err := payees.Create(ctx, householdID, payee.CreateInput{
			Name: in.NewPayee.Name, CNPJ: boletoCNPJ, LegalName: boletoName, DefaultCategoryID: &in.CategoryID,
		})
		if err != nil {
			return err
		}
		p.inv.PayeeID = &np.ID
		if created != nil {
			created[key] = np.ID
		}
	case in.PayeeID != nil && boletoCNPJ != nil:
		if _, err := payees.AdoptCNPJ(ctx, householdID, *in.PayeeID, *boletoCNPJ, boletoName); err != nil {
			return err
		}
	}
	if err := tx.Create(&p.inv).Error; err != nil {
		return fmt.Errorf("criando invoice: %w", err)
	}
	if p.bol != nil {
		p.bol.InvoiceID, p.bol.HouseholdID = p.inv.ID, householdID
		if err := tx.Create(p.bol).Error; err != nil {
			return fmt.Errorf("gravando boleto: %w", err)
		}
	}
	return nil
}

// boletoRow converte o boleto lido (valor e vencimento calculados da linha, não do que o cliente disse) na linha do banco.
func boletoRow(p boleto.Boleto, beneficiary *string) *Boleto {
	row := &Boleto{DigitableLine: p.DigitableLine, Barcode: &p.Barcode}
	if p.AmountCents > 0 {
		c := money.Cents(p.AmountCents)
		row.DocumentAmountCents = &c
	}
	if !p.DueDate.IsZero() {
		row.DocumentDueDate = caldate.FromTime(p.DueDate)
	}
	if beneficiary != nil {
		if name := strings.TrimSpace(*beneficiary); name != "" {
			if len(name) > 120 {
				name = name[:120]
			}
			row.BeneficiaryName = &name
		}
	}
	return row
}

// FindDuplicate devolve a invoice (não excluída) da casa que já tem esta linha digitável, se houver.
func (s *Service) FindDuplicate(ctx context.Context, householdID uuid.UUID, line string) (*uuid.UUID, error) {
	var ids []uuid.UUID
	err := s.db.WithContext(ctx).Table("invoice_boletos AS b").
		Joins("JOIN invoices i ON i.household_id = b.household_id AND i.id = b.invoice_id AND i.deleted_at IS NULL").
		Where("b.household_id = ? AND b.digitable_line = ?", householdID, line).
		Order("b.created_at").Limit(1).Pluck("b.invoice_id", &ids).Error
	if err != nil {
		return nil, fmt.Errorf("procurando boleto duplicado: %w", err)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	return &ids[0], nil
}

// ---------------------------------------------------------------- ler

func (s *Service) find(ctx context.Context, householdID, id uuid.UUID, unscoped bool) (Invoice, error) {
	q := s.db.WithContext(ctx)
	if unscoped {
		q = q.Unscoped() // inclui as excluídas (para restaurar)
	}
	var inv Invoice
	err := q.Where("household_id = ? AND id = ?", householdID, id).First(&inv).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Invoice{}, ErrNotFound
	}
	return inv, err
}

func (s *Service) Get(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	inv, err := s.find(ctx, householdID, id, false)
	if err != nil {
		return View{}, err
	}
	return s.viewOne(ctx, householdID, inv)
}

type ListFilter struct {
	Month             *caldate.Date // competência (dia 1)
	Status            Status        // "" = todos
	CategoryID        *uuid.UUID
	ResponsibleUserID *uuid.UUID
	PurchaseID        *uuid.UUID
	Q                 string
	Limit             int
	Cursor            string
}

type Page struct {
	Items      []View
	NextCursor string
}

// MaxSearchLen: a busca procura na descrição (até 120 caracteres); texto maior que isso não acha nada e só custa CPU.
const MaxSearchLen = 120

// CheckSearch apara a busca `q` e recusa texto longo demais.
func CheckSearch(q string, v *validation.Collector) string {
	q = strings.TrimSpace(q)
	if len([]rune(q)) > MaxSearchLen {
		v.Add("q", fmt.Sprintf("a busca pode ter até %d caracteres", MaxSearchLen))
	}
	return q
}

// EscapeLike faz % e _ valerem como texto numa busca ILIKE.
func EscapeLike(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(q)
}

func encodeCursor(i Invoice) string {
	return base64.RawURLEncoding.EncodeToString([]byte(i.DueDate.String() + "|" + i.ID.String()))
}

func decodeCursor(c string) (caldate.Date, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return caldate.Date{}, uuid.Nil, errors.New("cursor inválido")
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return caldate.Date{}, uuid.Nil, errors.New("cursor inválido")
	}
	d, err1 := caldate.ParseISO(parts[0])
	id, err2 := uuid.Parse(parts[1])
	if err1 != nil || err2 != nil {
		return caldate.Date{}, uuid.Nil, errors.New("cursor inválido")
	}
	return d, id, nil
}

// List devolve as invoices da casa ordenadas por vencimento (e id, para desempate estável),
// com paginação por cursor (keyset): funciona bem mesmo com muitas linhas e sem "pular" itens.
func (s *Service) List(ctx context.Context, householdID uuid.UUID, f ListFilter) (Page, error) {
	var v validation.Collector
	q := s.db.WithContext(ctx).Where("household_id = ?", householdID)
	today := s.today()

	if f.Month != nil {
		if !f.Month.IsStartOfMonth() {
			v.Add("month", "informe o primeiro dia do mês (AAAA-MM-01)")
		}
		q = q.Where("competence_month = ?", *f.Month)
	}
	switch f.Status {
	case "":
	case StatusPending:
		q = q.Where("paid_at IS NULL AND due_date >= ?", today)
	case StatusOverdue:
		q = q.Where("paid_at IS NULL AND due_date < ?", today)
	case StatusPaid:
		q = q.Where("paid_at IS NOT NULL")
	default:
		v.Add("status", "use pending, overdue ou paid")
	}
	if f.CategoryID != nil {
		q = q.Where("category_id = ?", *f.CategoryID)
	}
	if f.ResponsibleUserID != nil {
		q = q.Where("responsible_user_id = ?", *f.ResponsibleUserID)
	}
	if f.PurchaseID != nil {
		q = q.Where("purchase_id = ?", *f.PurchaseID)
	}
	if t := CheckSearch(f.Q, &v); t != "" {
		q = q.Where(`description ILIKE ? ESCAPE '\'`, "%"+EscapeLike(t)+"%")
	}
	if f.Cursor != "" {
		d, id, err := decodeCursor(f.Cursor)
		if err != nil {
			v.Add("cursor", err.Error())
		} else {
			q = q.Where("(due_date, id) > (?, ?)", d, id)
		}
	}
	if err := v.Err(); err != nil {
		return Page{}, err
	}

	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var rows []Invoice
	if err := q.Order("due_date, id").Limit(limit + 1).Find(&rows).Error; err != nil {
		return Page{}, err
	}
	page := Page{}
	if len(rows) > limit {
		page.NextCursor = encodeCursor(rows[limit-1])
		rows = rows[:limit]
	}
	views, err := s.Views(ctx, householdID, rows)
	if err != nil {
		return Page{}, err
	}
	page.Items = views
	return page, nil
}

// ---------------------------------------------------------------- editar / excluir

// Patch: nil = não mexer. Campos que aceitam "limpar" têm um flag Set (nil sozinho não distingue ausente de null).
type Patch struct {
	CategoryID        *uuid.UUID
	ResponsibleSet    bool
	ResponsibleUserID *uuid.UUID
	PayeeSet          bool
	PayeeID           *uuid.UUID
	Description       *string
	AmountCents       *money.Cents
	DueDate           *caldate.Date
	CompetenceMonth   *caldate.Date
	NotesSet          bool
	Notes             *string
}

// Scope define o alcance em séries: só esta ou esta e as seguintes.
type Scope string

const (
	ScopeThis      Scope = "this"
	ScopeFollowing Scope = "following"
)

// trailingNumbering reconhece o sufixo " (3/6)" que a geração de parcelas acrescenta à descrição.
var trailingNumbering = regexp.MustCompile(`\s*\(\d+/\d+\)\s*$`)

// Update edita a invoice. Com scope=following numa invoice de série, aplica também às seguintes da mesma série
// (regras em docs/developer-guide/series-generation.md): só pendentes, nunca as pagas; vencimento e competência não
// vão em lote (cada parcela/ocorrência tem o seu).
func (s *Service) Update(ctx context.Context, householdID, id uuid.UUID, p Patch, scope Scope) (View, error) {
	inv, err := s.find(ctx, householdID, id, false)
	if err != nil {
		return View{}, err
	}
	following := scope == ScopeFollowing && inv.InSeries()

	var v validation.Collector
	updates := map[string]any{}
	description := ""
	if p.Description != nil {
		description = CheckDescription(*p.Description, &v)
		updates["description"] = description
	}
	if p.AmountCents != nil {
		CheckAmount(*p.AmountCents, "amountCents", &v)
		updates["amount_cents"] = *p.AmountCents
	}
	if p.DueDate != nil {
		if p.DueDate.IsZero() {
			v.Add("dueDate", "informe a data de vencimento")
		}
		if following {
			v.Add("dueDate", "o vencimento não pode ser alterado em lote; edite cada uma (escopo \"só esta\")")
		}
		updates["due_date"] = *p.DueDate
	}
	if p.CompetenceMonth != nil {
		CheckCompetence(*p.CompetenceMonth, &v)
		if following {
			v.Add("competenceMonth", "a competência não pode ser alterada em lote; edite cada uma (escopo \"só esta\")")
		}
		updates["competence_month"] = *p.CompetenceMonth
	}
	if p.NotesSet {
		updates["notes"] = CheckNotes(p.Notes, &v)
	}
	if p.CategoryID != nil {
		updates["category_id"] = *p.CategoryID
	}
	if p.ResponsibleSet {
		updates["responsible_user_id"] = p.ResponsibleUserID
	}
	if p.PayeeSet {
		updates["payee_id"] = p.PayeeID
		if err := s.checkPayee(ctx, householdID, p.PayeeID, &v); err != nil {
			return View{}, err
		}
	}
	var newResp *uuid.UUID
	if p.ResponsibleSet {
		newResp = p.ResponsibleUserID
	}
	if err := s.CheckRefs(ctx, householdID, p.CategoryID, newResp, &v); err != nil {
		return View{}, err
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}

	if following {
		if err := s.updateFollowing(ctx, inv, updates, description); err != nil {
			return View{}, err
		}
	} else if len(updates) > 0 {
		res := s.db.WithContext(ctx).Model(&Invoice{}).Where("household_id = ? AND id = ?", householdID, id).Updates(updates)
		if res.Error != nil {
			return View{}, res.Error
		}
	}
	return s.Get(ctx, householdID, id)
}

// followingScope devolve a consulta "esta e as seguintes, ainda pendentes, da mesma série".
//   - parcelas: mesma compra e installment_number >= o da escolhida;
//   - recorrência: mesma recorrência e occurrence_month >= o da escolhida.
//
// Sempre filtra a casa. Excluídas ficam de fora (gorm.DeletedAt) e pagas também (paid_at IS NULL): editar/excluir em lote
// nunca reescreve nem apaga o que já foi pago.
func followingScope(tx *gorm.DB, inv Invoice) *gorm.DB {
	q := tx.Model(&Invoice{}).Where("household_id = ? AND paid_at IS NULL", inv.HouseholdID)
	if inv.PurchaseID != nil {
		return q.Where("purchase_id = ? AND installment_number >= ?", *inv.PurchaseID, *inv.InstallmentNumber)
	}
	return q.Where("recurrence_id = ? AND occurrence_month >= ?", *inv.RecurrenceID, inv.OccurrenceMonth)
}

func (s *Service) updateFollowing(ctx context.Context, inv Invoice, updates map[string]any, description string) error {
	if len(updates) == 0 {
		return nil
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if inv.PurchaseID != nil && description != "" {
			// Parcelas mantêm a numeração: "Notebook" vira "Notebook (3/6)", "Notebook (4/6)"...
			var count int
			err := tx.Table("purchases").Select("installments_count").
				Where("household_id = ? AND id = ?", inv.HouseholdID, *inv.PurchaseID).Scan(&count).Error
			if err != nil {
				return err
			}
			base := trailingNumbering.ReplaceAllString(description, "")
			updates["description"] = gorm.Expr("?::text || ' (' || installment_number::text || '/' || ?::text || ')'", base, strconv.Itoa(count))
		}
		if err := followingScope(tx, inv).Updates(updates).Error; err != nil {
			return err
		}
		if inv.RecurrenceID == nil {
			return nil
		}
		// Recorrência: o molde também muda, para as ocorrências geradas depois seguirem o novo valor.
		tpl := map[string]any{}
		for _, k := range []string{"category_id", "responsible_user_id", "description", "amount_cents", "notes"} {
			if val, ok := updates[k]; ok {
				tpl[k] = val
			}
		}
		if len(tpl) == 0 {
			return nil
		}
		return tx.Table("recurrences").Where("household_id = ? AND id = ?", inv.HouseholdID, *inv.RecurrenceID).Updates(tpl).Error
	})
}

// Delete faz a exclusão lógica (dá para desfazer com Restore). Com scope=following numa série, exclui esta e as
// seguintes pendentes (pagas ficam). Em recorrência, também encerra a série para o horizonte não recriar os meses.
//
// O lote inteiro recebe o MESMO deleted_at (um instante só, gravado também no cabeçalho e em recurrence_cuts): é
// assim que Restore(scope=following) sabe o que foi excluído junto e não ressuscita exclusões avulsas anteriores.
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID, scope Scope) error {
	inv, err := s.find(ctx, householdID, id, false)
	if err != nil {
		return err
	}
	// Microssegundos: a precisão do timestamptz. Assim o valor em Go é idêntico ao que fica no banco.
	at := time.Now().UTC().Truncate(time.Microsecond)
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if scope == ScopeFollowing && inv.InSeries() {
			// Update (e não Delete) para gravar o nosso instante; o escopo já ignora as excluídas (gorm.DeletedAt).
			if err := followingScope(tx, inv).Update("deleted_at", at).Error; err != nil {
				return err
			}
			if inv.RecurrenceID != nil {
				if err := endRecurrenceBefore(tx, inv, at); err != nil {
					return err
				}
			}
		} else if err := tx.Where("household_id = ? AND id = ?", householdID, id).Delete(&Invoice{}).Error; err != nil {
			return err
		}
		if inv.PurchaseID != nil {
			return closePurchaseIfEmpty(tx, inv, at)
		}
		return nil
	})
}

// closePurchaseIfEmpty exclui (logicamente) o cabeçalho da compra quando todas as parcelas foram excluídas.
func closePurchaseIfEmpty(tx *gorm.DB, inv Invoice, at time.Time) error {
	var n int64
	err := tx.Model(&Invoice{}).Where("household_id = ? AND purchase_id = ?", inv.HouseholdID, *inv.PurchaseID).Count(&n).Error
	if err != nil || n > 0 {
		return err
	}
	return tx.Table("purchases").Where("household_id = ? AND id = ? AND deleted_at IS NULL", inv.HouseholdID, *inv.PurchaseID).
		Update("deleted_at", at).Error
}

// recurrenceCut espelha `recurrence_cuts`: o que o lote mudou na recorrência, para o Desfazer voltar exatamente atrás.
type recurrenceCut struct {
	HouseholdID      uuid.UUID `gorm:"type:uuid"`
	RecurrenceID     uuid.UUID `gorm:"type:uuid"`
	BatchDeletedAt   time.Time
	PreviousEndMonth caldate.Date // zero = NULL (sem fim)
	CutEndMonth      caldate.Date // zero = NULL (o corte excluiu a recorrência)
}

func (recurrenceCut) TableName() string { return "recurrence_cuts" }

// endRecurrenceBefore encerra a recorrência no mês anterior ao da invoice escolhida (end_month só diminui). Se a escolhida
// é a primeira ocorrência (ou anterior ao início), a recorrência inteira é excluída. Registra o corte em recurrence_cuts
// (com o fim anterior) para Restore(scope=following) desfazer.
func endRecurrenceBefore(tx *gorm.DB, inv Invoice, at time.Time) error {
	where := "household_id = ? AND id = ? AND deleted_at IS NULL"
	var cur struct {
		StartMonth caldate.Date
		EndMonth   caldate.Date
	}
	// FOR UPDATE: o fim lido aqui é o que guardamos como "anterior"; ninguém o muda até o commit.
	res := tx.Table("recurrences").Select("start_month, end_month").Where(where, inv.HouseholdID, *inv.RecurrenceID).
		Clauses(clause.Locking{Strength: "UPDATE"}).Scan(&cur)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 { // recorrência já excluída: nada a encerrar
		return nil
	}
	cut := recurrenceCut{HouseholdID: inv.HouseholdID, RecurrenceID: *inv.RecurrenceID, BatchDeletedAt: at, PreviousEndMonth: cur.EndMonth}
	if !inv.OccurrenceMonth.After(cur.StartMonth) {
		if err := tx.Table("recurrences").Where(where, inv.HouseholdID, *inv.RecurrenceID).Update("deleted_at", at).Error; err != nil {
			return err
		}
		return tx.Create(&cut).Error
	}
	end := inv.OccurrenceMonth.AddMonths(-1)
	if !cur.EndMonth.IsZero() && !cur.EndMonth.After(end) {
		return nil // já termina antes: o fim não muda, não há o que desfazer
	}
	cut.CutEndMonth = end
	err := tx.Table("recurrences").Where(where, inv.HouseholdID, *inv.RecurrenceID).
		Updates(map[string]any{"end_month": end, "updated_at": gorm.Expr("now()")}).Error
	if err != nil {
		return err
	}
	return tx.Create(&cut).Error
}

// Restore desfaz a exclusão lógica. Com scope=following numa série, desfaz o LOTE "esta e as seguintes" a que a
// invoice pertence: restaura as da mesma série com número/mês maior ou igual e o MESMO deleted_at (exclusões avulsas
// anteriores têm outro instante e continuam excluídas), reabre a compra e devolve o fim (ou reativa) a recorrência.
func (s *Service) Restore(ctx context.Context, householdID, id uuid.UUID, scope Scope) (View, error) {
	inv, err := s.find(ctx, householdID, id, true)
	if err != nil {
		return View{}, err
	}
	if !inv.DeletedAt.Valid {
		return View{}, ErrNotDeleted
	}
	following := scope == ScopeFollowing && inv.InSeries()
	targets := s.db.WithContext(ctx).Unscoped().Model(&Invoice{}).Where("household_id = ?", householdID)
	if following {
		batch := inv.DeletedAt.Time
		if inv.PurchaseID != nil {
			targets = targets.Where("purchase_id = ? AND installment_number >= ?", *inv.PurchaseID, *inv.InstallmentNumber)
		} else {
			targets = targets.Where("recurrence_id = ? AND occurrence_month >= ?", *inv.RecurrenceID, inv.OccurrenceMonth)
		}
		targets = targets.Where("deleted_at = ?", batch)
	} else {
		targets = targets.Where("id = ?", id)
	}
	var ids, cats []uuid.UUID
	if err := targets.Session(&gorm.Session{}).Pluck("id", &ids).Error; err != nil {
		return View{}, err
	}
	if err := targets.Session(&gorm.Session{}).Distinct("category_id").Pluck("category_id", &cats).Error; err != nil {
		return View{}, err
	}
	var n int64
	if err := s.db.WithContext(ctx).Model(&category.Category{}).
		Where("household_id = ? AND id IN ?", householdID, cats).Count(&n).Error; err != nil {
		return View{}, err
	}
	if int(n) != len(cats) {
		return View{}, ErrCategoryGone
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Model(&Invoice{}).
			Where("household_id = ? AND id IN ? AND deleted_at IS NOT NULL", householdID, ids).Update("deleted_at", nil).Error; err != nil {
			return err
		}
		if following && inv.RecurrenceID != nil {
			if err := undoRecurrenceCut(tx, inv); err != nil {
				return err
			}
		}
		if inv.PurchaseID == nil {
			return nil
		}
		// Restaurar uma parcela traz de volta o cabeçalho da compra, se ele tinha sido excluído junto.
		return tx.Table("purchases").Where("household_id = ? AND id = ?", householdID, *inv.PurchaseID).
			Update("deleted_at", nil).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.Get(ctx, householdID, id)
}

// undoRecurrenceCut desfaz o que endRecurrenceBefore fez no lote da invoice: reativa a recorrência ou devolve o fim
// anterior. Só se a recorrência estiver exatamente como o lote a deixou; se mudou depois (ex.: outro corte mais cedo
// ainda não desfeito), devolve ErrSeriesChanged em vez de adivinhar.
func undoRecurrenceCut(tx *gorm.DB, inv Invoice) error {
	var cut recurrenceCut
	res := tx.Where("household_id = ? AND recurrence_id = ? AND batch_deleted_at = ?", inv.HouseholdID, *inv.RecurrenceID, inv.DeletedAt.Time).
		Limit(1).Find(&cut)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return nil // o lote não mexeu na recorrência (ou é anterior a este registro)
	}
	rec := tx.Table("recurrences").Where("household_id = ? AND id = ?", inv.HouseholdID, *inv.RecurrenceID)
	var upd *gorm.DB
	if cut.CutEndMonth.IsZero() {
		upd = rec.Where("deleted_at = ?", cut.BatchDeletedAt).Update("deleted_at", nil)
	} else {
		upd = rec.Where("deleted_at IS NULL AND end_month = ?", cut.CutEndMonth).
			Updates(map[string]any{"end_month": cut.PreviousEndMonth, "updated_at": gorm.Expr("now()")})
	}
	if upd.Error != nil {
		return upd.Error
	}
	if upd.RowsAffected == 0 {
		return ErrSeriesChanged
	}
	return tx.Where("household_id = ? AND recurrence_id = ? AND batch_deleted_at = ?", inv.HouseholdID, *inv.RecurrenceID, cut.BatchDeletedAt).
		Delete(&recurrenceCut{}).Error
}

// ---------------------------------------------------------------- pagar

type PayInput struct {
	Wallet      string
	PaidAt      *caldate.Date // nil = hoje
	AmountCents *money.Cents  // nil = valor da invoice (informe se houve juros/desconto)
}

// Pay marca a invoice como paga. O UPDATE é condicional (`paid_at IS NULL`): dois cliques simultâneos
// (ou duas pessoas) não pagam duas vezes, e o segundo recebe ErrAlreadyPaid.
func (s *Service) Pay(ctx context.Context, householdID, id, userID uuid.UUID, in PayInput) (View, error) {
	inv, err := s.find(ctx, householdID, id, false)
	if err != nil {
		return View{}, err
	}
	var v validation.Collector
	if !category.ValidWallet(in.Wallet) {
		v.Add("wallet", "use free (livre) ou benefit (benefício)")
	}
	paidAt := s.today()
	if in.PaidAt != nil {
		paidAt = *in.PaidAt
		if paidAt.IsZero() {
			v.Add("paidAt", "data de pagamento inválida")
		}
	}
	amount := inv.AmountCents
	if in.AmountCents != nil {
		amount = *in.AmountCents
		CheckAmount(amount, "amountCents", &v)
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}

	res := s.db.WithContext(ctx).Model(&Invoice{}).
		Where("household_id = ? AND id = ? AND paid_at IS NULL", householdID, id).
		Updates(map[string]any{"paid_at": paidAt, "paid_wallet": in.Wallet, "paid_amount_cents": amount, "paid_by_user_id": userID})
	if res.Error != nil {
		return View{}, res.Error
	}
	if res.RowsAffected == 0 { // ou foi excluída agora, ou alguém pagou antes
		if _, err := s.find(ctx, householdID, id, false); err != nil {
			return View{}, err
		}
		return View{}, ErrAlreadyPaid
	}
	return s.Get(ctx, householdID, id)
}

// Unpay desfaz o pagamento (os quatro campos voltam a NULL).
func (s *Service) Unpay(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	res := s.db.WithContext(ctx).Model(&Invoice{}).
		Where("household_id = ? AND id = ? AND paid_at IS NOT NULL", householdID, id).
		Updates(map[string]any{"paid_at": nil, "paid_wallet": nil, "paid_amount_cents": nil, "paid_by_user_id": nil})
	if res.Error != nil {
		return View{}, res.Error
	}
	if res.RowsAffected == 0 {
		if _, err := s.find(ctx, householdID, id, false); err != nil {
			return View{}, err
		}
		return View{}, ErrNotPaid
	}
	return s.Get(ctx, householdID, id)
}
