// Package summary calcula o resumo mensal e os saldos das carteiras. Só LÊ (nada é gravado) e tudo é escopado por
// household_id. Regras e definições em docs/developer-guide/incomes-and-wallets.md.
package summary

import (
	"context"
	"database/sql"
	"sort"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/income"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

// WalletBalance são os números de uma carteira num mês. O saldo é CALCULADO (nada é gravado), mas agora é
// transportado: o que sobra (ou falta) de um mês entra como saldo anterior do próximo.
type WalletBalance struct {
	WalletID    uuid.UUID
	Name        string
	OwnerUserID *uuid.UUID
	IsDefault   bool
	Archived    bool
	// Opening: saldo inicial cadastrado na carteira.
	Opening money.Cents
	// OpeningMonth: mês (dia 1) em que o saldo inicial passa a valer; nil = desde o começo.
	OpeningMonth *caldate.Date
	// CarryOver: saldo anterior = saldo inicial + soma, dos meses ANTERIORES ao consultado (e a partir do mês de início,
	// se houver), de (recebido - pago + transferências recebidas - enviadas). Antes do mês de início é 0.
	CarryOver money.Cents
	// Expected: líquido de TODAS as receitas do mês na carteira (previstas + recebidas).
	Expected money.Cents
	// Received: líquido só das receitas já recebidas.
	Received money.Cents
	// Paid: soma do valor efetivamente pago (paid_amount_cents) das invoices pagas com a carteira, por competência.
	Paid money.Cents
	// Pending: ESTIMATIVA do que falta pagar com esta carteira. A carteira de uma conta pendente só é conhecida ao pagar,
	// então usamos a carteira padrão da categoria (ou da categoria principal); sem padrão, vai para a padrão da casa.
	Pending money.Cents
	// TransfersIn / TransfersOut: transferências entre carteiras do mês (por competência). Não são receita nem despesa:
	// só movem saldo e nunca entram nos totais, nas categorias nem em Expected/Received/Paid.
	TransfersIn  money.Cents
	TransfersOut money.Cents
}

// Balance é o saldo REALIZADO acumulado: saldo anterior + recebido - pago + transferências recebidas - enviadas.
// Pode ser negativo. Não é saldo bancário.
func (w WalletBalance) Balance() money.Cents { return w.CarryOver + w.MonthBalance() }

// MonthBalance é só o movimento do mês: recebido - pago + transferências recebidas - enviadas.
func (w WalletBalance) MonthBalance() money.Cents {
	return w.Received - w.Paid + w.TransfersIn - w.TransfersOut
}

// Projected é o saldo projetado do mês: saldo anterior + tudo o que está previsto para entrar - tudo o que sai (pago + a
// pagar). É o número principal do resumo: só fica negativo se, quando tudo acontecer, vai faltar. Receita ainda não
// marcada como recebida não é alarme.
func (w WalletBalance) Projected() money.Cents {
	return w.CarryOver + w.Expected - w.Paid - w.Pending + w.TransfersIn - w.TransfersOut
}

// hasMovement: o mês tem alguma receita, pagamento, conta a pagar ou transferência nesta carteira.
func (w WalletBalance) hasMovement() bool {
	return w.Expected != 0 || w.Received != 0 || w.Paid != 0 || w.Pending != 0 || w.TransfersIn != 0 || w.TransfersOut != 0
}

type CategoryTotal struct {
	CategoryID uuid.UUID
	// Total: o que a categoria pesa no mês = valor efetivamente pago (se paga) ou valor da invoice (se pendente).
	Total money.Cents
	// Paid: parte já paga (paid_amount_cents).
	Paid money.Cents
}

type Summary struct {
	Month caldate.Date
	// Wallets: a padrão primeiro, depois por sort_order e nome. Arquivada só entra com saldo anterior ou movimento.
	Wallets      []WalletBalance
	TotalPaid    money.Cents
	TotalPending money.Cents // inclui as atrasadas
	Overdue      money.Cents // parte do pendente já vencida
	OverdueCount int
	ByCategory   []CategoryTotal
}

type Service struct {
	db    *gorm.DB
	today func() caldate.Date // "hoje" no fuso da aplicação (atraso e intervalo padrão do histórico); injetável nos testes
}

// NewService recebe `today` como função (e não um valor) para que cada chamada veja o dia corrente; nos testes, um relógio fixo.
func NewService(db *gorm.DB, today func() caldate.Date) *Service {
	return &Service{db: db, today: today}
}

// sinceOpening é o filtro do saldo anterior, ÚNICO para recebido, pago e transferências (e portanto para o resumo, o
// aviso de saldo e o projetado): só conta o movimento a partir do mês de início da carteira `w` (NULL = sempre conta).
// `col` é a coluna de competência da linha. Quem usa precisa juntar a tabela wallets com o alias `w`.
func sinceOpening(col string) string {
	return "(w.opening_balance_month IS NULL OR " + col + " >= w.opening_balance_month)"
}

// Linhas cruas das consultas agregadas (os SUM saem como bigint; ver ::bigint nas consultas).
// Carry = soma dos meses ANTERIORES ao consultado.
type incomeRow struct {
	WalletID uuid.UUID
	Expected money.Cents
	Received money.Cents
	Carry    money.Cents // recebido líquido antes do mês
}

type paidRow struct {
	WalletID uuid.UUID
	Paid     money.Cents
	Carry    money.Cents // pago antes do mês
}

// transferRow: transferências (não excluídas) por carteira: o que entrou e saiu no mês e o acumulado dos meses anteriores
// (já com sinal: entrada - saída), que vira saldo anterior.
type transferRow struct {
	WalletID uuid.UUID
	In       money.Cents
	Out      money.Cents
	Carry    money.Cents // (recebido - enviado) antes do mês
}

// pendingRow: pendentes da competência por carteira ESTIMADA (padrão da categoria), com a parte atrasada.
type pendingRow struct {
	WalletID     uuid.UUID
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

// listWallets: todas as carteiras da casa (inclusive arquivadas; o filtro "tem saldo ou movimento" é do assemble), na
// ordem de exibição: padrão primeiro, depois sort_order e nome.
func (s *Service) listWallets(ctx context.Context, householdID uuid.UUID) ([]wallet.Wallet, error) {
	var rows []wallet.Wallet
	err := s.db.WithContext(ctx).Where("household_id = ?", householdID).
		Order("is_default DESC, sort_order, lower(name), id").Find(&rows).Error
	return rows, err
}

// incomesByWallet: líquido (bruto - descontos) por carteira, do mês (previsto e recebido) e dos meses anteriores (só o
// recebido, que vira saldo anterior). "Recebida" é o estado derivado de income.ReceivedSQL (a data esperada chegou e
// ninguém disse "não caiu"), então há o parâmetro "hoje". Os descontos entram por subconsulta correlacionada (usa o
// índice de income_deductions por income_id), tudo numa consulta só. Exclui lançamentos apagados.
func (s *Service) incomesByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]incomeRow, error) {
	var rows []incomeRow
	// ReceivedSQL usa um `?` posicional para o "hoje"; aqui os parâmetros são nomeados, então troca por @today.
	recv := strings.Replace(income.ReceivedSQL("i"), "?", "@today", 1)
	err := s.db.WithContext(ctx).Raw(`
		SELECT i.wallet_id AS wallet_id,
		       COALESCE(SUM(net.v) FILTER (WHERE i.competence_month = @month), 0)::bigint AS expected,
		       COALESCE(SUM(net.v) FILTER (WHERE i.competence_month = @month AND `+recv+`), 0)::bigint AS received,
		       COALESCE(SUM(net.v) FILTER (WHERE i.competence_month < @month AND `+sinceOpening("i.competence_month")+` AND `+recv+`), 0)::bigint AS carry
		FROM incomes i
		JOIN wallets w ON w.household_id = i.household_id AND w.id = i.wallet_id
		CROSS JOIN LATERAL (
			SELECT i.gross_amount_cents - COALESCE((
				SELECT SUM(d.amount_cents) FROM income_deductions d
				WHERE d.household_id = i.household_id AND d.income_id = i.id), 0) AS v
		) net
		WHERE i.household_id = @hh AND i.competence_month <= @month AND i.deleted_at IS NULL
		GROUP BY i.wallet_id`, sql.Named("hh", householdID), sql.Named("month", month), sql.Named("today", s.today())).Scan(&rows).Error
	return rows, err
}

// paidByWallet: invoices PAGAS, somando o valor efetivamente pago, por carteira de pagamento: do mês e dos meses
// anteriores (saldo anterior).
func (s *Service) paidByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]paidRow, error) {
	var rows []paidRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT inv.paid_wallet_id AS wallet_id,
		       COALESCE(SUM(inv.paid_amount_cents) FILTER (WHERE inv.competence_month = @month), 0)::bigint AS paid,
		       COALESCE(SUM(inv.paid_amount_cents) FILTER (WHERE inv.competence_month < @month AND `+sinceOpening("inv.competence_month")+`), 0)::bigint AS carry
		FROM invoices inv
		JOIN wallets w ON w.household_id = inv.household_id AND w.id = inv.paid_wallet_id
		WHERE inv.household_id = @hh AND inv.competence_month <= @month AND inv.deleted_at IS NULL AND inv.paid_at IS NOT NULL
		GROUP BY inv.paid_wallet_id`, sql.Named("hh", householdID), sql.Named("month", month)).Scan(&rows).Error
	return rows, err
}

// transfersByWallet: transferências entre carteiras, uma linha por carteira (origem e destino entram na mesma consulta
// via UNION ALL, com o sinal certo), do mês e dos meses anteriores. Exclui as apagadas.
func (s *Service) transfersByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]transferRow, error) {
	var rows []transferRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT t.wallet_id,
		       COALESCE(SUM(t.inc) FILTER (WHERE t.competence_month = @month), 0)::bigint AS "in",
		       COALESCE(SUM(t.out) FILTER (WHERE t.competence_month = @month), 0)::bigint AS "out",
		       COALESCE(SUM(t.inc - t.out) FILTER (WHERE t.competence_month < @month AND `+sinceOpening("t.competence_month")+`), 0)::bigint AS carry
		FROM (
			SELECT to_wallet_id AS wallet_id, competence_month, amount_cents AS inc, 0::bigint AS out
			FROM wallet_transfers WHERE household_id = @hh AND competence_month <= @month AND deleted_at IS NULL
			UNION ALL
			SELECT from_wallet_id, competence_month, 0::bigint, amount_cents
			FROM wallet_transfers WHERE household_id = @hh AND competence_month <= @month AND deleted_at IS NULL
		) t
		JOIN wallets w ON w.household_id = @hh AND w.id = t.wallet_id
		GROUP BY t.wallet_id`, sql.Named("hh", householdID), sql.Named("month", month)).Scan(&rows).Error
	return rows, err
}

// pendingByWallet: invoices PENDENTES da competência, atribuídas à carteira padrão da categoria (a da filha; se não tiver,
// a da mãe; se nenhuma, a carteira padrão da casa). Conta também o que já venceu (due_date < hoje). Uma consulta, LEFT JOINs por chave.
func (s *Service) pendingByWallet(ctx context.Context, householdID uuid.UUID, month caldate.Date) ([]pendingRow, error) {
	var rows []pendingRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT COALESCE(c.default_wallet_id, p.default_wallet_id, dw.id) AS wallet_id,
		       COALESCE(SUM(i.amount_cents), 0)::bigint AS pending,
		       COALESCE(SUM(CASE WHEN i.due_date < @today THEN i.amount_cents ELSE 0 END), 0)::bigint AS overdue,
		       COUNT(*) FILTER (WHERE i.due_date < @today) AS overdue_count
		FROM invoices i
		LEFT JOIN categories c ON c.household_id = i.household_id AND c.id = i.category_id
		LEFT JOIN categories p ON p.household_id = c.household_id AND p.id = c.parent_id
		LEFT JOIN wallets dw ON dw.household_id = i.household_id AND dw.is_default
		WHERE i.household_id = @hh AND i.competence_month = @month AND i.deleted_at IS NULL AND i.paid_at IS NULL
		GROUP BY 1`, sql.Named("hh", householdID), sql.Named("month", month), sql.Named("today", s.today())).Scan(&rows).Error
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

// Month monta o resumo da competência `month` da casa: 6 consultas (carteiras, receitas, pagos, pendentes, transferências, categorias),
// todas agregadas por carteira/categoria, sem N+1.
func (s *Service) Month(ctx context.Context, householdID uuid.UUID, month caldate.Date) (Summary, error) {
	if err := checkMonth(month); err != nil {
		return Summary{}, err
	}
	ws, err := s.listWallets(ctx, householdID)
	if err != nil {
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
	tr, err := s.transfersByWallet(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	cats, err := s.byCategory(ctx, householdID, month)
	if err != nil {
		return Summary{}, err
	}
	return assemble(month, ws, inc, paid, pend, tr, cats), nil
}

// OverdraftWarning diz se uma carteira com o aviso de saldo ligado ficou com saldo REALIZADO negativo até a competência
// `month` (usado no aviso ao pagar; já inclui o pagamento recém-gravado). Carteira sem o aviso devolve false.
// Reaproveita as mesmas consultas agregadas do resumo.
func (s *Service) OverdraftWarning(ctx context.Context, householdID, walletID uuid.UUID, month caldate.Date) (bool, error) {
	if err := checkMonth(month); err != nil {
		return false, err
	}
	ws, err := s.listWallets(ctx, householdID)
	if err != nil {
		return false, err
	}
	var w *wallet.Wallet
	for i := range ws {
		if ws[i].ID == walletID {
			w = &ws[i]
		}
	}
	if w == nil || !w.WarnOnOverdraft {
		return false, nil
	}
	inc, err := s.incomesByWallet(ctx, householdID, month)
	if err != nil {
		return false, err
	}
	paid, err := s.paidByWallet(ctx, householdID, month)
	if err != nil {
		return false, err
	}
	tr, err := s.transfersByWallet(ctx, householdID, month)
	if err != nil {
		return false, err
	}
	// Uma carteira arquivada com saldo zero some do resumo; aqui só interessa a pedida, então ela sempre entra.
	for _, b := range assemble(month, []wallet.Wallet{*w}, inc, paid, nil, tr, nil).Wallets {
		if b.WalletID == walletID {
			return b.Balance() < 0, nil
		}
	}
	return false, nil
}

// assemble junta as linhas agregadas no resumo. É PURA (sem banco) para ser testada em tabela. `ws` já vem na ordem de
// exibição (padrão primeiro). Carteira arquivada só entra se tem saldo anterior diferente de zero ou movimento (inclusive transferência) no mês.
func assemble(month caldate.Date, ws []wallet.Wallet, inc []incomeRow, paid []paidRow, pend []pendingRow, tr []transferRow, cats []categoryRow) Summary {
	out := Summary{Month: month, Wallets: []WalletBalance{}, ByCategory: []CategoryTotal{}}
	byID := make(map[uuid.UUID]*WalletBalance, len(ws))
	list := make([]*WalletBalance, len(ws))
	for i, w := range ws {
		// O saldo inicial só vale a partir do mês de início: antes dele a carteira "ainda não começou" (as consultas já
		// deixam de fora o movimento anterior ao início, ver sinceOpening).
		carry := w.OpeningBalanceCents
		if w.OpeningBalanceMonth != nil && month.Before(*w.OpeningBalanceMonth) {
			carry = 0
		}
		list[i] = &WalletBalance{WalletID: w.ID, Name: w.Name, OwnerUserID: w.OwnerUserID, IsDefault: w.IsDefault,
			Archived: w.Archived(), Opening: w.OpeningBalanceCents, OpeningMonth: w.OpeningBalanceMonth, CarryOver: carry}
		byID[w.ID] = list[i]
	}
	// Linhas de carteira desconhecida (não deveria ocorrer: FK composta) são ignoradas, nunca viram pânico.
	for _, r := range inc {
		if w := byID[r.WalletID]; w != nil {
			w.Expected += r.Expected
			w.Received += r.Received
			w.CarryOver += r.Carry
		}
	}
	for _, r := range paid {
		if w := byID[r.WalletID]; w != nil {
			w.Paid += r.Paid
			w.CarryOver -= r.Carry
		}
	}
	for _, r := range tr {
		if w := byID[r.WalletID]; w != nil {
			w.TransfersIn += r.In
			w.TransfersOut += r.Out
			w.CarryOver += r.Carry
		}
	}
	for _, r := range pend {
		if w := byID[r.WalletID]; w != nil {
			w.Pending += r.Pending
		}
		out.Overdue += r.Overdue
		out.OverdueCount += r.OverdueCount
	}
	for _, w := range list {
		if w.Archived && w.CarryOver == 0 && !w.hasMovement() {
			continue
		}
		out.Wallets = append(out.Wallets, *w)
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
