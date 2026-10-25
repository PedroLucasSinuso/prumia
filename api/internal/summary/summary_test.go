package summary

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/wallet"
)

var oct = caldate.New(2026, 10, 1)

func TestSaldoEhAnteriorMaisRecebidoMenosPago(t *testing.T) {
	cases := []struct {
		name          string
		w             WalletBalance
		want, inMonth int64
	}{
		{"só recebido", WalletBalance{Received: 500000}, 500000, 500000},
		{"previsto não conta no saldo", WalletBalance{Expected: 900000, Received: 500000, Paid: 200000}, 300000, 300000},
		{"pode ficar negativo", WalletBalance{Received: 100000, Paid: 150000}, -50000, -50000},
		{"saldo anterior entra no saldo, não no movimento do mês", WalletBalance{CarryOver: 70000, Received: 100000, Paid: 150000}, 20000, -50000},
		{"saldo anterior negativo", WalletBalance{CarryOver: -30000, Received: 100000}, 70000, 100000},
		{"vazio", WalletBalance{}, 0, 0},
	}
	for _, c := range cases {
		if got := int64(c.w.Balance()); got != c.want {
			t.Errorf("%s: saldo %d, quer %d", c.name, got, c.want)
		}
		if got := int64(c.w.MonthBalance()); got != c.inMonth {
			t.Errorf("%s: saldo do mês %d, quer %d", c.name, got, c.inMonth)
		}
	}
}

func TestProjetadoSomaOSaldoAnterior(t *testing.T) {
	w := WalletBalance{CarryOver: 100000, Expected: 600000, Received: 400000, Paid: 150000, Pending: 90000}
	if got := w.Projected(); got != 460000 { // 100000 + 600000 - 150000 - 90000
		t.Errorf("projetado %d, quer 460000", got)
	}
}

func uid(n byte) uuid.UUID { return uuid.UUID{15: n} }

func mkWallet(n byte, name string, def bool, opening int64, archived bool) wallet.Wallet {
	w := wallet.Wallet{HouseholdID: uid(99), Name: name, IsDefault: def, OpeningBalanceCents: money.Cents(opening)}
	w.ID = uid(n)
	if archived {
		at := time.Now()
		w.ArchivedAt = &at
	}
	return w
}

func TestAssembleSeparaCarteirasEOrdenaCategorias(t *testing.T) {
	a, b, c := uid(0xa), uid(0xb), uid(0xc)
	geral, vr := mkWallet(1, "Geral", true, 0, false), mkWallet(2, "Benefício", false, 0, false)
	got := assemble(oct, []wallet.Wallet{geral, vr},
		[]incomeRow{{WalletID: geral.ID, Expected: 600000, Received: 400000}, {WalletID: vr.ID, Expected: 80000, Received: 80000}},
		[]paidRow{{WalletID: geral.ID, Paid: 150000}, {WalletID: vr.ID, Paid: 90000}},
		[]pendingRow{{WalletID: geral.ID, Pending: 90000, Overdue: 40000, OverdueCount: 1}, {WalletID: vr.ID, Pending: 50000, Overdue: 50000, OverdueCount: 2}},
		nil, nil,
		[]categoryRow{
			{CategoryID: b, Total: 50000, Paid: 50000},
			{CategoryID: a, Total: 240000, Paid: 150000, Pending: 90000},
			{CategoryID: c, Total: 50000, Pending: 50000}, // empata com b: desempata por id
		})
	if len(got.Wallets) != 2 || got.Wallets[0].WalletID != geral.ID || !got.Wallets[0].IsDefault {
		t.Fatalf("a padrão deveria vir primeiro: %+v", got.Wallets)
	}
	free, ben := got.Wallets[0], got.Wallets[1]
	if free.Balance() != 250000 || free.Expected != 600000 {
		t.Errorf("geral: %+v", free)
	}
	if ben.Balance() != -10000 {
		t.Errorf("benefício deveria estar negativo: %+v", ben)
	}
	if got.TotalPaid != 200000 || got.TotalPending != 140000 {
		t.Errorf("totais: pago %d pendente %d", got.TotalPaid, got.TotalPending)
	}
	// projetado = previsto - pago - a pagar (estimado por carteira)
	if free.Pending != 90000 || free.Projected() != 360000 || ben.Projected() != -60000 {
		t.Errorf("projetado: geral %+v benefício %+v", free, ben)
	}
	if got.Overdue != 90000 || got.OverdueCount != 3 {
		t.Errorf("atraso: %d em %d contas", got.Overdue, got.OverdueCount)
	}
	order := []uuid.UUID{a, b, c}
	for i, id := range order {
		if got.ByCategory[i].CategoryID != id {
			t.Fatalf("ordem das categorias: %+v", got.ByCategory)
		}
	}
}

func TestAssembleSaldoAnteriorCarregaInicialRecebidoEPago(t *testing.T) {
	geral := mkWallet(1, "Geral", true, 100000, false) // saldo inicial R$ 1.000,00
	got := assemble(oct, []wallet.Wallet{geral},
		[]incomeRow{{WalletID: geral.ID, Expected: 500000, Received: 500000, Carry: 300000}},
		[]paidRow{{WalletID: geral.ID, Paid: 200000, Carry: 450000}}, nil, nil, nil, nil)
	w := got.Wallets[0]
	// anterior = 1000 + 3000 - 4500 = -500 (negativo); saldo = -500 + 5000 - 2000
	if w.Opening != 100000 || w.CarryOver != -50000 || w.Balance() != 250000 || w.MonthBalance() != 300000 {
		t.Errorf("saldo anterior: %+v (saldo %d)", w, w.Balance())
	}
}

func TestAssembleArquivadaSoApareceComSaldoOuMovimento(t *testing.T) {
	ativa := mkWallet(1, "Geral", true, 0, false)
	vazia := mkWallet(2, "Antiga", false, 0, true)
	comSaldo := mkWallet(3, "Poupança velha", false, 5000, true)
	comMovimento := mkWallet(4, "VR velho", false, 0, true)
	got := assemble(oct, []wallet.Wallet{ativa, vazia, comSaldo, comMovimento},
		[]incomeRow{{WalletID: comMovimento.ID, Expected: 1000, Received: 1000}}, nil, nil, nil, nil, nil)
	var names []string
	for _, w := range got.Wallets {
		names = append(names, w.Name)
	}
	if len(names) != 3 || names[0] != "Geral" || names[1] != "Poupança velha" || names[2] != "VR velho" {
		t.Errorf("carteiras no resumo: %v", names)
	}
}

func TestAssembleIgnoraCarteiraDesconhecida(t *testing.T) {
	geral := mkWallet(1, "Geral", true, 0, false)
	got := assemble(oct, []wallet.Wallet{geral}, []incomeRow{{WalletID: uid(77), Received: 5}}, nil, nil, nil, nil, nil)
	if got.Wallets[0].Received != 0 {
		t.Errorf("linha de outra carteira não deveria somar: %+v", got.Wallets[0])
	}
}

func TestAssembleMesVazio(t *testing.T) {
	got := assemble(oct, nil, nil, nil, nil, nil, nil, nil)
	if got.ByCategory == nil || len(got.ByCategory) != 0 || got.Wallets == nil || len(got.Wallets) != 0 || got.TotalPaid != 0 {
		t.Errorf("mês vazio: %+v", got)
	}
}

func TestMesPrecisaSerDia1(t *testing.T) {
	if err := checkMonth(caldate.New(2026, 10, 15)); err == nil {
		t.Error("dia 15 deveria ser recusado")
	}
	if err := checkMonth(caldate.Date{}); err == nil {
		t.Error("zero deveria ser recusado")
	}
	if err := checkMonth(oct); err != nil {
		t.Error(err)
	}
}

func TestProjetadoIgnoraSeAReceitaJaFoiMarcada(t *testing.T) {
	// dia 22: salário previsto ainda não marcado como recebido. O realizado fica negativo, o projetado não.
	w := WalletBalance{Expected: 600000, Received: 0, Paid: 252681, Pending: 100000}
	if w.Balance() >= 0 {
		t.Fatalf("realizado deveria ser negativo: %d", w.Balance())
	}
	if w.Projected() != 247319 {
		t.Errorf("projetado: %d", w.Projected())
	}
}

func TestAssembleTransferenciasMexemSoNosSaldos(t *testing.T) {
	geral, reserva := mkWallet(1, "Geral", true, 0, false), mkWallet(2, "Reserva", false, 0, false)
	antiga := mkWallet(3, "Antiga", false, 0, true)
	got := assemble(oct, []wallet.Wallet{geral, reserva, antiga},
		[]incomeRow{{WalletID: geral.ID, Expected: 500000, Received: 500000}},
		[]paidRow{{WalletID: geral.ID, Paid: 100000}},
		[]pendingRow{{WalletID: geral.ID, Pending: 50000}},
		[]transferRow{
			{WalletID: geral.ID, Out: 30000, Carry: -20000}, // guardou 300 no mês e 200 antes
			{WalletID: reserva.ID, In: 30000, Carry: 20000},
			{WalletID: antiga.ID, In: 1000}, // arquivada com transferência no mês aparece
		}, nil, nil)
	if len(got.Wallets) != 3 {
		t.Fatalf("carteiras: %+v", got.Wallets)
	}
	g, r := got.Wallets[0], got.Wallets[1]
	// geral: anterior -200; saldo = -200 + 5000 - 1000 - 300 = 3500; projetado = -200 + 5000 - 1000 - 500 - 300 = 3000
	if g.CarryOver != -20000 || g.Balance() != 350000 || g.MonthBalance() != 370000 || g.Projected() != 300000 {
		t.Errorf("geral: %+v (saldo %d, mês %d, projetado %d)", g, g.Balance(), g.MonthBalance(), g.Projected())
	}
	if r.CarryOver != 20000 || r.Balance() != 50000 || r.TransfersIn != 30000 || r.Projected() != 50000 {
		t.Errorf("reserva: %+v", r)
	}
	// transferência não é receita nem despesa
	if g.Expected != 500000 || g.Received != 500000 || g.Paid != 100000 || got.TotalPaid != 0 || got.TotalPending != 0 || len(got.ByCategory) != 0 {
		t.Errorf("transferência vazou para receita/despesa: %+v", got)
	}
}

// Mês de início: antes dele o saldo inicial não entra; no mês entra sozinho; depois entra + o que as consultas somaram
// (que já deixam de fora o movimento anterior ao início, ver sinceOpening).
func TestAssembleMesDeInicioDoSaldoInicial(t *testing.T) {
	start := caldate.New(2026, 10, 1)
	w := mkWallet(1, "Conta", true, 100000, false)
	w.OpeningBalanceMonth = &start
	run := func(month caldate.Date, carry int64) WalletBalance {
		got := assemble(month, []wallet.Wallet{w},
			[]incomeRow{{WalletID: w.ID, Received: 20000, Expected: 20000, Carry: money.Cents(carry)}}, nil, nil, nil, nil, nil)
		return got.Wallets[0]
	}
	if b := run(caldate.New(2026, 9, 1), 0); b.CarryOver != 0 || b.Opening != 100000 || b.Balance() != 20000 || b.OpeningMonth == nil {
		t.Errorf("antes do início: %+v", b)
	}
	if b := run(start, 0); b.CarryOver != 100000 || b.Balance() != 120000 {
		t.Errorf("no início: %+v", b)
	}
	if b := run(caldate.New(2026, 11, 1), 20000); b.CarryOver != 120000 {
		t.Errorf("depois do início: %+v", b)
	}
	// sem mês de início: saldo inicial em todos os meses (comportamento anterior)
	w.OpeningBalanceMonth = nil
	if b := run(caldate.New(2026, 9, 1), 0); b.CarryOver != 100000 || b.OpeningMonth != nil {
		t.Errorf("sem mês de início: %+v", b)
	}
	// arquivada antes do início, sem movimento: some; com saldo inicial vigente: aparece
	w.OpeningBalanceMonth = &start
	at := time.Now()
	w.ArchivedAt = &at
	if got := assemble(caldate.New(2026, 9, 1), []wallet.Wallet{w}, nil, nil, nil, nil, nil, nil); len(got.Wallets) != 0 {
		t.Errorf("arquivada antes do início e sem movimento deveria sumir: %+v", got.Wallets)
	}
	if got := assemble(start, []wallet.Wallet{w}, nil, nil, nil, nil, nil, nil); len(got.Wallets) != 1 {
		t.Errorf("arquivada com saldo inicial vigente deveria aparecer: %+v", got.Wallets)
	}
}

// Ajuste de saldo ("Conferir saldo"): como a transferência, só mexe no saldo (do mês e, pelo saldo anterior, dos meses
// seguintes), nunca em receita, despesa ou categoria.
func TestAssembleAjustesMexemSoNosSaldos(t *testing.T) {
	geral := mkWallet(1, "Geral", true, 0, false)
	antiga := mkWallet(2, "Antiga", false, 0, true)
	got := assemble(oct, []wallet.Wallet{geral, antiga},
		[]incomeRow{{WalletID: geral.ID, Expected: 500000, Received: 500000}},
		[]paidRow{{WalletID: geral.ID, Paid: 100000}},
		[]pendingRow{{WalletID: geral.ID, Pending: 50000}},
		nil,
		[]adjustmentRow{
			{WalletID: geral.ID, Month: -150000, Carry: -30000}, // gastos esquecidos: 1500 no mês e 300 antes
			{WalletID: antiga.ID, Month: 1000},                  // arquivada com ajuste no mês aparece
		}, nil)
	if len(got.Wallets) != 2 {
		t.Fatalf("carteiras: %+v", got.Wallets)
	}
	g := got.Wallets[0]
	// anterior -300; saldo = -300 + 5000 - 1000 - 1500 = 2200; mês = 5000 - 1000 - 1500 = 2500; projetado = 2200 - 500 = 1700
	if g.CarryOver != -30000 || g.Adjustments != -150000 || g.Balance() != 220000 || g.MonthBalance() != 250000 || g.Projected() != 170000 {
		t.Errorf("geral: %+v (saldo %d, mês %d, projetado %d)", g, g.Balance(), g.MonthBalance(), g.Projected())
	}
	if g.Expected != 500000 || g.Received != 500000 || g.Paid != 100000 || got.TotalPaid != 0 || got.TotalPending != 0 || len(got.ByCategory) != 0 {
		t.Errorf("ajuste vazou para receita/despesa: %+v", got)
	}
}

// O cenário do plano: receita de outubro sem os gastos lançados; em novembro a pessoa confere e o saldo real passa a
// valer. O ajuste de outubro (gravado com a diferença) entra no saldo anterior de novembro.
func TestAjusteDeOutubroFazNovembroComecarDoSaldoReal(t *testing.T) {
	geral := mkWallet(1, "Geral", true, 0, false)
	nov := caldate.New(2026, 11, 1)
	// outubro: recebeu 5000, nada pago lançado => calculado 5000; o real era 1200 => ajuste de -3800 em outubro
	got := assemble(nov, []wallet.Wallet{geral},
		[]incomeRow{{WalletID: geral.ID, Carry: 500000}}, nil, nil, nil,
		[]adjustmentRow{{WalletID: geral.ID, Carry: -380000}}, nil)
	if b := got.Wallets[0]; b.CarryOver != 120000 || b.Balance() != 120000 || b.Adjustments != 0 {
		t.Errorf("novembro deveria começar com o saldo real (1200): %+v", b)
	}
}
