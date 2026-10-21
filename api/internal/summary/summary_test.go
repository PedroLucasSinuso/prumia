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
	order := []uuid.UUID{a, b, c}
	for i, id := range order {
		if got.ByCategory[i].CategoryID != id {
			t.Fatalf("ordem das categorias: %+v", got.ByCategory)
		}
	}
}

func TestAssembleMesVazio(t *testing.T) {
	got := assemble(oct, nil, nil, nil)
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
