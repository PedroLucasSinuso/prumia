// Package summary calcula o resumo mensal e os saldos das carteiras. Só LÊ (nada é gravado) e tudo é escopado por
// household_id. Regras e definições em docs/developer-guide/incomes-and-wallets.md.
package summary

import (
	"context"
	"sort"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// WalletBalance são os números de uma carteira num mês. Não existe tabela de carteira: ela é derivada.
type WalletBalance struct {
	// Expected: líquido de TODAS as receitas do mês na carteira (previstas + recebidas).
	Expected money.Cents
	// Received: líquido só das receitas já recebidas.
	Received money.Cents
	// Paid: soma do valor efetivamente pago (paid_amount_cents) das invoices pagas com a carteira, por competência.
	Paid money.Cents
	// Pending: ESTIMATIVA do que falta pagar com esta carteira. A carteira de uma conta pendente só é conhecida ao pagar,
	// então usamos a carteira padrão da categoria (ou da categoria principal); sem padrão, vai para a livre.
	Pending money.Cents
}

// Balance é o saldo estimado: recebido menos pago. Pode ser negativo. Não é saldo bancário.
func (w WalletBalance) Balance() money.Cents { return w.Received - w.Paid }

// Projected é o saldo projetado do mês: tudo o que está previsto para entrar menos tudo o que sai (pago + a pagar).
// É o número principal do resumo: só fica negativo se, quando tudo acontecer, vai faltar. Receita ainda não marcada como
// recebida não é alarme.
func (w WalletBalance) Projected() money.Cents { return w.Expected - w.Paid - w.Pending }

type CategoryTotal struct {
	CategoryID uuid.UUID
	// Total: o que a categoria pesa no mês = valor efetivamente pago (se paga) ou valor da invoice (se pendente).
	Total money.Cents
	// Paid: parte já paga (paid_amount_cents).
	Paid money.Cents
}

type Summary struct {
	Month         caldate.Date
	Free, Benefit WalletBalance
	TotalPaid     money.Cents
	TotalPending  money.Cents // inclui as atrasadas
	Overdue       money.Cents // parte do pendente já vencida
	OverdueCount  int
	ByCategory    []CategoryTotal
}

type Service struct {
	db    *gorm.DB
	today func() caldate.Date // "hoje" no fuso da aplicação (atraso e intervalo padrão do histórico); injetável nos testes
}

// NewService recebe `today` como função (e não um valor) para que cada chamada veja o dia corrente; nos testes, um relógio fixo.
func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today}
}

// Linhas cruas das consultas agregadas (os SUM saem como bigint; ver ::bigint nas consultas).
type incomeRow struct {
	Wallet   string
	Expected money.Cents
	Received money.Cents
}

type paidRow struct {
	Wallet string
	Paid   money.Cents
}

// pendingRow: pendentes da competência por carteira ESTIMADA (padrão da categoria), com a parte atrasada.
type pendingRow struct {
	Wallet       string
	Pending      money.Cents
	Overdue      money.Cents
	OverdueCount int
}

type categoryRow struct {
	CategoryID uuid.UUID
	Total      money.Cents
	Paid       money.Cents
	Pending    money.Cents
}

func checkMonth(month caldate.Date) error {
	if month.IsZero() || !month.IsStartOfMonth() {
		return validation.New("month", "informe o primeiro dia do mês (AAAA-MM-01)")
	}
	return nil
}

// incomesByWallet: líquido (bruto - descontos) por carteira. Os descontos entram por subconsulta correlacionada
// (usa o índice de income_deductions por income_id), tudo numa consulta só. Exclui lançamentos apagados.
func (s *Service) incomesByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]incomeRow, error) {
	var rows []incomeRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT i.wallet AS wallet,
		       COALESCE(SUM(net.v), 0)::bigint AS expected,
		       COALESCE(SUM(CASE WHEN i.received_at IS NOT NULL THEN net.v ELSE 0 END), 0)::bigint AS received
		FROM incomes i
		CROSS JOIN LATERAL (
			SELECT i.gross_amount_cents - COALESCE((
				SELECT SUM(d.amount_cents) FROM income_deductions d
				WHERE d.household_id = i.household_id AND d.income_id = i.id), 0) AS v
		) net
		WHERE i.household_id = ? AND i.competence_month = ? AND i.deleted_at IS NULL
		GROUP BY i.wallet`, householdID, month).Scan(&rows).Error
	return rows, err
}

// paidByWallet: invoices PAGAS da competência, somando o valor efetivamente pago, por carteira de pagamento.
func (s *Service) paidByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]paidRow, error) {
	var rows []paidRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT paid_wallet AS wallet, COALESCE(SUM(paid_amount_cents), 0)::bigint AS paid
		FROM invoices
		WHERE household_id = ? AND competence_month = ? AND deleted_at IS NULL AND paid_at IS NOT NULL
		GROUP BY paid_wallet`, householdID, month).Scan(&rows).Error
	return rows, err
}

// pendingByWallet: invoices PENDENTES da competência, atribuídas à carteira padrão da categoria (a da filha; se não tiver,
// a da mãe; se nenhuma, livre). Conta também o que já venceu (due_date < hoje). Uma consulta, dois LEFT JOINs por chave.
func (s *Service) pendingByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]pendingRow, error) {
	var rows []pendingRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT COALESCE(c.default_wallet, p.default_wallet, 'free') AS wallet,
		       COALESCE(SUM(i.amount_cents), 0)::bigint AS pending,
		       COALESCE(SUM(CASE WHEN i.due_date < ? THEN i.amount_cents ELSE 0 END), 0)::bigint AS overdue,
		       COUNT(*) FILTER (WHERE i.due_date < ?) AS overdue_count
		FROM invoices i
		LEFT JOIN categories c ON c.household_id = i.household_id AND c.id = i.category_id
		LEFT JOIN categories p ON p.household_id = c.household_id AND p.id = c.parent_id
		WHERE i.household_id = ? AND i.competence_month = ? AND i.deleted_at IS NULL AND i.paid_at IS NULL
		GROUP BY 1`, s.today(), s.today(), householdID, month).Scan(&rows).Error
	return rows, err
}

// byCategory: uma linha por categoria com as invoices da competência (pagas e pendentes).
func (s *Service) byCategory(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]categoryRow, error) {
	var rows []categoryRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT category_id AS category_id,
		       COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN paid_amount_cents ELSE amount_cents END), 0)::bigint AS total,
		       COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN paid_amount_cents ELSE 0 END), 0)::bigint AS paid,
		       COALESCE(SUM(CASE WHEN paid_at IS NULL THEN amount_cents ELSE 0 END), 0)::bigint AS pending
		FROM invoices
		WHERE household_id = ? AND competence_month = ? AND deleted_at IS NULL
		GROUP BY category_id`, householdID, month).Scan(&rows).Error
	return rows, err
}

// Month monta o resumo da competência `month` da casa: 4 consultas agregadas, sem N+1.
func (s *Service) Month(ctx context.Context, householdID uuid.UUID, month caldate.Date) (Summary, error) {
	if err := checkMonth(month); err != nil {
		return Summary{}, err
	}
	inc, err := s.incomesByWallet(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	paid, err := s.paidByWallet(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	pend, err := s.pendingByWallet(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	cats, err := s.byCategory(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	return assemble(month, inc, paid, pend, cats), nil
}

// BenefitBalance é o saldo da carteira de benefício na competência (usado no aviso ao pagar). Duas consultas leves.
func (s *Service) BenefitBalance(ctx context.Context, householdID uuid.UUID, month caldate.Date) (money.Cents, error) {
	if err := checkMonth(month); err != nil {
		return 0, err
	}
	inc, err := s.incomesByWallet(ctx, householdID, month)
	if err != nil {
		return 0, err
	}
	paid, err := s.paidByWallet(ctx, householdID, month)
	if err != nil {
		return 0, err
	}
	return assemble(month, inc, paid, nil, nil).Benefit.Balance(), nil
}

// assemble junta as linhas agregadas no resumo. É PURA (sem banco) para ser testada em tabela.
func assemble(month caldate.Date, inc []incomeRow, paid []paidRow, pend []pendingRow, cats []categoryRow) Summary {
	out := Summary{Month: month, ByCategory: []CategoryTotal{}}
	wallet := func(name string) *WalletBalance {
		if name == "benefit" {
			return &out.Benefit
		}
		return &out.Free
	}
	for _, r := range inc {
		w := wallet(r.Wallet)
		w.Expected += r.Expected
		w.Received += r.Received
	}
	for _, r := range paid {
		wallet(r.Wallet).Paid += r.Paid
	}
	for _, r := range pend {
		wallet(r.Wallet).Pending += r.Pending
		out.Overdue += r.Overdue
		out.OverdueCount += r.OverdueCount
	}
	for _, r := range cats {
		out.TotalPaid += r.Paid
		out.TotalPending += r.Pending
		out.ByCategory = append(out.ByCategory, CategoryTotal{CategoryID: r.CategoryID, Total: r.Total, Paid: r.Paid})
	}
	// Maior total primeiro; empate resolvido pelo id, para a ordem ser estável.
	sort.Slice(out.ByCategory, func(i, j int) bool {
		a, b := out.ByCategory[i], out.ByCategory[j]
		if a.Total != b.Total {
			return a.Total > b.Total
		}
		return a.CategoryID.String() < b.CategoryID.String()
	})
	return out
}
