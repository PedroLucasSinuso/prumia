package api

import (
	"net/http"
	"testing"
)

type reserveT struct {
	TargetMonths          *int     `json:"targetMonths"`
	WalletIDs             []string `json:"walletIds"`
	EssentialMonthlyCents int64    `json:"essentialMonthlyCents"`
	BasisMonths           int      `json:"basisMonths"`
	SavedCents            int64    `json:"savedCents"`
	TargetCents           int64    `json:"targetCents"`
}

func (a *app) reserveOf(c *http.Cookie, house, month string) reserveT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/reserve?month="+month, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("reserva: %d %s", r.Code, r.Body)
	}
	var out reserveT
	r.json(&out)
	return out
}

func (a *app) catNamed(c *http.Cookie, house, name string) string {
	a.t.Helper()
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	for _, x := range cats {
		if x.Name == name {
			return x.ID
		}
	}
	a.t.Fatalf("categoria %q não encontrada", name)
	return ""
}

// Meta em meses de gasto essencial: a média olha os meses anteriores que tiveram conta (só categorias essenciais; paga
// conta pelo valor pago) e o progresso é o saldo realizado das carteiras de reserva.
func TestReservaMetaEProgresso(t *testing.T) {
	a, c, house, _ := casa(t) // hoje = 18/10/2026
	// casa sem meta: nada configurado
	if got := a.reserveOf(c, house, "2026-10-01"); got.TargetMonths != nil || len(got.WalletIDs) != 0 || got.SavedCents != 0 || got.TargetCents != 0 {
		t.Fatalf("sem meta: %+v", got)
	}
	moradia, lazer := a.catNamed(c, house, "Moradia"), a.catNamed(c, house, "Lazer")
	mk := func(catID, due string, cents int64) inv {
		t.Helper()
		i, r := a.newInvoice(c, house, catID, map[string]any{"amountCents": cents, "dueDate": due})
		if r.Code != 201 {
			t.Fatal(r.Body)
		}
		return i
	}
	mk(moradia, "2026-08-10", 100000)
	sep := mk(moradia, "2026-09-10", 130000)
	a.pay(c, house, sep.ID, a.free(house), map[string]any{"amountCents": 120000}) // pagou com desconto: vale o pago
	mk(lazer, "2026-09-15", 50000)                                                // não essencial: fora da média
	mk(moradia, "2026-03-10", 999999)                                             // fora da janela de 6 meses

	reserva, r := a.newWallet(c, house, map[string]any{"name": "Reserva", "openingBalanceCents": 330000})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	six := 6
	r = a.do("PUT", "/api/households/"+house+"/reserve", map[string]any{"targetMonths": six, "walletIds": []string{reserva.ID}}, c)
	if r.Code != 200 {
		t.Fatalf("configurar: %d %s", r.Code, r.Body)
	}
	got := a.reserveOf(c, house, "2026-10-01")
	// média de agosto (1000) e setembro (1200 pago) = 1100; abril-julho sem conta não puxam a média para baixo
	if got.TargetMonths == nil || *got.TargetMonths != 6 || got.EssentialMonthlyCents != 110000 || got.BasisMonths != 2 ||
		got.SavedCents != 330000 || got.TargetCents != 660000 || len(got.WalletIDs) != 1 || got.WalletIDs[0] != reserva.ID {
		t.Errorf("reserva de outubro: %+v", got)
	}
	// sem histórico antes do mês: usa o próprio mês
	if got := a.reserveOf(c, house, "2026-08-01"); got.EssentialMonthlyCents != 100000 || got.BasisMonths != 1 {
		t.Errorf("sem histórico: %+v", got)
	}
	// desligar a meta e tirar as carteiras
	if r := a.do("PUT", "/api/households/"+house+"/reserve", map[string]any{"targetMonths": nil, "walletIds": []string{}}, c); r.Code != 200 {
		t.Fatalf("desligar: %d %s", r.Code, r.Body)
	}
	if got := a.reserveOf(c, house, "2026-10-01"); got.TargetMonths != nil || len(got.WalletIDs) != 0 || got.SavedCents != 0 || got.TargetCents != 0 {
		t.Errorf("desligada: %+v", got)
	}
}

func TestReservaValidacoesPapeisEIsolamento(t *testing.T) {
	a, c, house, _ := casa(t)
	davi, _ := a.newUser("Davi", "davi@x.com")
	carla, _ := a.newUser("Carla", "carla@x.com")
	a.join(c, house, "member", davi)
	a.join(c, house, "viewer", carla)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	put := func(who *http.Cookie, h string, body map[string]any) resp {
		return a.do("PUT", "/api/households/"+h+"/reserve", body, who)
	}
	for _, m := range []int{0, 37} {
		assertField(t, put(c, house, map[string]any{"targetMonths": m, "walletIds": []string{}}), 400, "targetMonths")
	}
	assertField(t, put(c, house, map[string]any{"targetMonths": 6, "walletIds": []string{a.free(houseB)}}), 400, "walletIds")
	assertField(t, put(c, house, map[string]any{"targetMonths": 6, "walletIds": []string{fakeID}}), 400, "walletIds")
	if r := put(davi, house, map[string]any{"targetMonths": 6, "walletIds": []string{}}); r.Code != 403 {
		t.Errorf("member configurando: %d %s", r.Code, r.Body)
	}
	if r := put(carla, house, map[string]any{"targetMonths": 6, "walletIds": []string{}}); r.Code != 403 {
		t.Errorf("viewer configurando: %d %s", r.Code, r.Body)
	}
	// qualquer membro lê
	if got := a.reserveOf(carla, house, "2026-10-01"); got.TargetMonths != nil {
		t.Errorf("viewer lendo: %+v", got)
	}
	// isolamento: configurar a casa A não muda a B, e a B não lê nem grava a A
	if r := put(c, house, map[string]any{"targetMonths": 3, "walletIds": []string{a.free(house)}}); r.Code != 200 {
		t.Fatalf("admin: %d %s", r.Code, r.Body)
	}
	if got := a.reserveOf(cB, houseB, "2026-10-01"); got.TargetMonths != nil || len(got.WalletIDs) != 0 {
		t.Errorf("casa B mudou: %+v", got)
	}
	if r := a.do("GET", "/api/households/"+house+"/reserve?month=2026-10-01", nil, cB); r.Code != 404 {
		t.Errorf("ler a A pela B: %d", r.Code)
	}
	if r := put(cB, house, map[string]any{"targetMonths": 1, "walletIds": []string{}}); r.Code != 404 {
		t.Errorf("gravar a A pela B: %d", r.Code)
	}
	if r := a.do("GET", "/api/households/"+house+"/reserve?month=2026-10-15", nil, c); r.Code != 400 {
		t.Errorf("mês fora do dia 1: %d", r.Code)
	}
}
