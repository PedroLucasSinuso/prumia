package invoice

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/category"
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
	out := make([]View, len(rows))
	for i, r := range rows {
		out[i] = View{Invoice: r, Status: statusOf(r, today)}
		if r.PurchaseID != nil {
			if n := counts[*r.PurchaseID]; n > 0 {
				out[i].InstallmentsCount = &n
			}
		}
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
	Description       string
	AmountCents       money.Cents
	DueDate           caldate.Date
	CompetenceMonth   *caldate.Date // nil = mês do vencimento
	Notes             *string
}

func (s *Service) Create(ctx context.Context, householdID, userID uuid.UUID, in CreateInput) (View, error) {
	var v validation.Collector
	in.Description = CheckDescription(in.Description, &v)
	CheckAmount(in.AmountCents, "amountCents", &v)
	if in.DueDate.IsZero() {
		v.Add("dueDate", "informe a data de vencimento")
	}
	competence := in.DueDate.StartOfMonth()
	if in.CompetenceMonth != nil {
		competence = *in.CompetenceMonth
		CheckCompetence(competence, &v)
	}
	in.Notes = CheckNotes(in.Notes, &v)
	if err := s.CheckRefs(ctx, householdID, &in.CategoryID, in.ResponsibleUserID, &v); err != nil {
		return View{}, err
	}
	if err := v.Err(); err != nil {
		return View{}, err
	}
	inv := Invoice{
		HouseholdID: householdID, CategoryID: in.CategoryID, ResponsibleUserID: in.ResponsibleUserID,
		Description: in.Description, AmountCents: in.AmountCents, DueDate: in.DueDate, CompetenceMonth: competence,
		Notes: in.Notes, CreatedBy: userID,
	}
	if err := s.db.WithContext(ctx).Create(&inv).Error; err != nil {
		return View{}, fmt.Errorf("criando invoice: %w", err)
	}
	return s.view(inv), nil
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
	if t := strings.TrimSpace(f.Q); t != "" {
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
func (s *Service) Delete(ctx context.Context, householdID, id uuid.UUID, scope Scope) error {
	inv, err := s.find(ctx, householdID, id, false)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if scope == ScopeFollowing && inv.InSeries() {
			if err := followingScope(tx, inv).Delete(&Invoice{}).Error; err != nil {
				return err
			}
			if inv.RecurrenceID != nil {
				if err := endRecurrenceBefore(tx, inv); err != nil {
					return err
				}
			}
		} else if err := tx.Where("household_id = ? AND id = ?", householdID, id).Delete(&Invoice{}).Error; err != nil {
			return err
		}
		if inv.PurchaseID != nil {
			return closePurchaseIfEmpty(tx, inv)
		}
		return nil
	})
}

// closePurchaseIfEmpty exclui (logicamente) o cabeçalho da compra quando todas as parcelas foram excluídas.
func closePurchaseIfEmpty(tx *gorm.DB, inv Invoice) error {
	var n int64
	err := tx.Model(&Invoice{}).Where("household_id = ? AND purchase_id = ?", inv.HouseholdID, *inv.PurchaseID).Count(&n).Error
	if err != nil || n > 0 {
		return err
	}
	return tx.Table("purchases").Where("household_id = ? AND id = ? AND deleted_at IS NULL", inv.HouseholdID, *inv.PurchaseID).
		Update("deleted_at", gorm.Expr("now()")).Error
}

// endRecurrenceBefore encerra a recorrência no mês anterior ao da invoice escolhida (end_month só diminui). Se a escolhida
// é a primeira ocorrência (ou anterior ao início), a recorrência inteira é excluída.
func endRecurrenceBefore(tx *gorm.DB, inv Invoice) error {
	where := "household_id = ? AND id = ? AND deleted_at IS NULL"
	var start caldate.Date
	err := tx.Table("recurrences").Select("start_month").Where(where, inv.HouseholdID, *inv.RecurrenceID).Row().Scan(&start)
	if errors.Is(err, sql.ErrNoRows) { // recorrência já excluída: nada a encerrar
		return nil
	}
	if err != nil {
		return err
	}
	if !inv.OccurrenceMonth.After(start) {
		return tx.Table("recurrences").Where(where, inv.HouseholdID, *inv.RecurrenceID).
			Update("deleted_at", gorm.Expr("now()")).Error
	}
	end := inv.OccurrenceMonth.AddMonths(-1)
	return tx.Table("recurrences").Where(where, inv.HouseholdID, *inv.RecurrenceID).Updates(map[string]any{
		"end_month":  gorm.Expr("CASE WHEN end_month IS NULL OR end_month > ? THEN ?::date ELSE end_month END", end, end),
		"updated_at": gorm.Expr("now()"),
	}).Error
}

// Restore desfaz a exclusão lógica.
func (s *Service) Restore(ctx context.Context, householdID, id uuid.UUID) (View, error) {
	inv, err := s.find(ctx, householdID, id, true)
	if err != nil {
		return View{}, err
	}
	if !inv.DeletedAt.Valid {
		return View{}, ErrNotDeleted
	}
	var n int64
	if err := s.db.WithContext(ctx).Model(&category.Category{}).
		Where("household_id = ? AND id = ?", householdID, inv.CategoryID).Count(&n).Error; err != nil {
		return View{}, err
	}
	if n == 0 {
		return View{}, ErrCategoryGone
	}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Model(&Invoice{}).
			Where("household_id = ? AND id = ?", householdID, id).Update("deleted_at", nil).Error; err != nil {
			return err
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
