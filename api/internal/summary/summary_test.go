package summary

import (
	"testing"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

var oct = caldate.New(2026, 10, 1)

func TestSaldoEhRecebidoMenosPago(t *testing.T) {
	cases := []struct {
		name string
		w    WalletBalance
		want int64
	}{
		{"só recebido", WalletBalance{Received: 500000}, 500000},
		{"previsto não conta no saldo", WalletBalance{Expected: 900000, Received: 500000, Paid: 200000}, 300000},
		{"pode ficar negativo", WalletBalance{Received: 100000, Paid: 150000}, -50000},
		{"vazio", WalletBalance{}, 0},
	}
	for _, c := range cases {
		if got := int64(c.w.Balance()); got != c.want {
			t.Errorf("%s: saldo %d, quer %d", c.name, got, c.want)
		}
	}
}

func TestAssembleSeparaCarteirasEOrdenaCategorias(t *testing.T) {
	a, b, c := uuid.MustParse("00000000-0000-0000-0000-00000000000a"), uuid.MustParse("00000000-0000-0000-0000-00000000000b"), uuid.MustParse("00000000-0000-0000-0000-00000000000c")
	got := assemble(oct,
		[]incomeRow{{Wallet: "free", Expected: 600000, Received: 400000}, {Wallet: "benefit", Expected: 80000, Received: 80000}},
		[]paidRow{{Wallet: "free", Paid: 150000}, {Wallet: "benefit", Paid: 90000}},
		[]pendingRow{{Wallet: "free", Pending: 90000, Overdue: 40000, OverdueCount: 1}, {Wallet: "benefit", Pending: 50000, Overdue: 50000, OverdueCount: 2}},
		[]categoryRow{
			{CategoryID: b, Total: 50000, Paid: 50000},
			{CategoryID: a, Total: 240000, Paid: 150000, Pending: 90000},
			{CategoryID: c, Total: 50000, Pending: 50000}, // empata com b: desempata por id
		})
	if got.Free.Balance() != 250000 || got.Free.Expected != 600000 {
		t.Errorf("livre: %+v", got.Free)
	}
	if got.Benefit.Balance() != -10000 {
		t.Errorf("benefício deveria estar negativo: %+v", got.Benefit)
	}
	if got.TotalPaid != 200000 || got.TotalPending != 140000 {
		t.Errorf("totais: pago %d pendente %d", got.TotalPaid, got.TotalPending)
	}
	// projetado = previsto - pago - a pagar (estimado por carteira)
	if got.Free.Pending != 90000 || got.Free.Projected() != 360000 || got.Benefit.Projected() != -60000 {
		t.Errorf("projetado: livre %+v benefício %+v", got.Free, got.Benefit)
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

func TestAssembleMesVazio(t *testing.T) {
	got := assemble(oct, nil, nil, nil, nil)
	if got.ByCategory == nil || len(got.ByCategory) != 0 || got.Free.Balance() != 0 || got.TotalPaid != 0 {
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
