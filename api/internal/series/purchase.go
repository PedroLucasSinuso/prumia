package series

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/invoice"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

var ErrNotFound = errors.New("não encontrado")

const (
	minInstallments = 2
	maxInstallments = 120
	// maxSeriesDescription deixa folga para o sufixo " (120/120)" caber nos 120 caracteres da descrição da invoice.
	maxSeriesDescription = 100
	// maxMonthsAway limita quão longe (passado ou futuro) uma série pode começar, para uma requisição não gerar milhares de linhas.
	maxMonthsAway = 120
)

// PurchaseService cria e consulta compras parceladas.
type PurchaseService struct {
	db  *gorm.DB
	inv *invoice.Service // validações compartilhadas (categoria, responsável, valores)
}

func NewPurchaseService(db *gorm.DB, inv *invoice.Service) *PurchaseService {
	return &PurchaseService{db: db, inv: inv}
}

// Detail é a compra com suas parcelas (as não excluídas, em ordem).
type Detail struct {
	Purchase     Purchase
	Installments []invoice.Invoice
}

type PurchaseInput struct {
	CategoryID        uuid.UUID
	ResponsibleUserID *uuid.UUID
	Description       string
	PurchaseDate      caldate.Date
	TotalAmountCents  money.Cents
	InstallmentsCount int
	FirstDueDate      caldate.Date
	// InstallmentAmountCents: opcional. Se informado, todas as parcelas valem isso (sem resto) e o total fica como informado.
	InstallmentAmountCents *money.Cents
	Notes                  *string
}

// Create grava a compra e TODAS as parcelas (passadas e futuras) numa transação: ou nasce tudo, ou nada.
func (s *PurchaseService) Create(ctx context.Context, householdID, userID uuid.UUID, in PurchaseInput) (Detail, error) {
	var v validation.Collector
	in.Description = strings.TrimSpace(in.Description)
	if n := len([]rune(in.Description)); n < 1 || n > maxSeriesDescription {
		v.Add("description", fmt.Sprintf("informe uma descrição de 1 a %d caracteres", maxSeriesDescription))
	}
	invoice.CheckAmount(in.TotalAmountCents, "totalAmountCents", &v)
	if in.InstallmentsCount < minInstallments || in.InstallmentsCount > maxInstallments {
		v.Add("installmentsCount", fmt.Sprintf("informe de %d a %d parcelas", minInstallments, maxInstallments))
	}
	if in.PurchaseDate.IsZero() {
		v.Add("purchaseDate", "informe a data da compra")
	}
	if in.FirstDueDate.IsZero() {
		v.Add("firstDueDate", "informe o vencimento da 1ª parcela")
	}
	var per money.Cents
	if in.InstallmentAmountCents != nil {
		per = *in.InstallmentAmountCents
		invoice.CheckAmount(per, "installmentAmountCents", &v)
	}
	in.Notes = invoice.CheckNotes(in.Notes, &v)
	if err := s.inv.CheckRefs(ctx, householdID, &in.CategoryID, in.ResponsibleUserID, &v); err != nil {
		return Detail{}, err
	}
	if err := v.Err(); err != nil {
		return Detail{}, err
	}
	parts, err := GenerateInstallments(in.TotalAmountCents, in.InstallmentsCount, per, in.FirstDueDate)
	if err != nil { // defesa: a validação acima já cobre
		return Detail{}, validation.New("installmentsCount", err.Error())
	}

	p := Purchase{
		HouseholdID: householdID, CategoryID: in.CategoryID, ResponsibleUserID: in.ResponsibleUserID,
		Description: in.Description, PurchaseDate: in.PurchaseDate, TotalAmountCents: in.TotalAmountCents,
		InstallmentsCount: in.InstallmentsCount, Notes: in.Notes, CreatedBy: userID,
	}
	rows := make([]invoice.Invoice, len(parts))
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&p).Error; err != nil {
			return fmt.Errorf("criando compra: %w", err)
		}
		for i, part := range parts {
			n := part.Number
			rows[i] = invoice.Invoice{
				HouseholdID: householdID, CategoryID: in.CategoryID, ResponsibleUserID: in.ResponsibleUserID,
				Description: fmt.Sprintf("%s (%d/%d)", in.Description, part.Number, in.InstallmentsCount),
				AmountCents: part.Amount, DueDate: part.DueDate, CompetenceMonth: part.Competence,
				PurchaseID: &p.ID, InstallmentNumber: &n, Notes: in.Notes, CreatedBy: userID,
			}
		}
		if err := tx.CreateInBatches(&rows, 100).Error; err != nil {
			return fmt.Errorf("criando parcelas: %w", err)
		}
		return nil
	})
	if err != nil {
		return Detail{}, err
	}
	return Detail{Purchase: p, Installments: rows}, nil
}

// Get devolve a compra com as parcelas. Compra de outra casa ou excluída = ErrNotFound.
func (s *PurchaseService) Get(ctx context.Context, householdID, id uuid.UUID) (Detail, error) {
	var p Purchase
	err := s.db.WithContext(ctx).Where("household_id = ? AND id = ?", householdID, id).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	var rows []invoice.Invoice
	err = s.db.WithContext(ctx).Where("household_id = ? AND purchase_id = ?", householdID, id).
		Order("installment_number").Find(&rows).Error
	if err != nil {
		return Detail{}, err
	}
	return Detail{Purchase: p, Installments: rows}, nil
}

type PurchaseFilter struct {
	Q      string
	Limit  int
	Cursor string
}

type PurchasePage struct {
	Items      []Detail
	NextCursor string
}

func encodeCursor(p Purchase) string {
	return base64.RawURLEncoding.EncodeToString([]byte(p.PurchaseDate.String() + "|" + p.ID.String()))
}

func decodeCursor(c string) (caldate.Date, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(c)
	parts := strings.SplitN(string(raw), "|", 2)
	if err != nil || len(parts) != 2 {
		return caldate.Date{}, uuid.Nil, errors.New("cursor inválido")
	}
	d, err1 := caldate.ParseISO(parts[0])
	id, err2 := uuid.Parse(parts[1])
	if err1 != nil || err2 != nil {
		return caldate.Date{}, uuid.Nil, errors.New("cursor inválido")
	}
	return d, id, nil
}

// List devolve as compras da casa, da mais recente para a mais antiga (data da compra, depois id), com cursor (keyset).
// Cada compra vem com as parcelas não excluídas, em ordem: UMA consulta a mais para a página inteira (sem N+1).
func (s *PurchaseService) List(ctx context.Context, householdID uuid.UUID, f PurchaseFilter) (PurchasePage, error) {
	var v validation.Collector
	q := s.db.WithContext(ctx).Where("household_id = ?", householdID)
	if t := invoice.CheckSearch(f.Q, &v); t != "" {
		q = q.Where(`description ILIKE ? ESCAPE '\'`, "%"+invoice.EscapeLike(t)+"%")
	}
	if f.Cursor != "" {
		d, id, err := decodeCursor(f.Cursor)
		if err != nil {
			v.Add("cursor", err.Error())
		} else {
			q = q.Where("(purchase_date, id) < (?, ?)", d, id)
		}
	}
	if err := v.Err(); err != nil {
		return PurchasePage{}, err
	}
	limit := f.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var rows []Purchase
	if err := q.Order("purchase_date DESC, id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		return PurchasePage{}, err
	}
	page := PurchasePage{}
	if len(rows) > limit {
		page.NextCursor = encodeCursor(rows[limit-1])
		rows = rows[:limit]
	}
	page.Items = make([]Detail, len(rows))
	if len(rows) == 0 {
		return page, nil
	}
	ids := make([]uuid.UUID, len(rows))
	pos := make(map[uuid.UUID]int, len(rows))
	for i, p := range rows {
		ids[i], pos[p.ID] = p.ID, i
		page.Items[i] = Detail{Purchase: p, Installments: []invoice.Invoice{}}
	}
	var inst []invoice.Invoice
	err := s.db.WithContext(ctx).Where("household_id = ? AND purchase_id IN ?", householdID, ids).
		Order("purchase_id, installment_number").Find(&inst).Error
	if err != nil {
		return PurchasePage{}, fmt.Errorf("lendo parcelas: %w", err)
	}
	for _, i := range inst {
		d := &page.Items[pos[*i.PurchaseID]]
		d.Installments = append(d.Installments, i)
	}
	return page, nil
}
