package api

import (
	"net/http"
	"strings"
	"testing"
)

type adjustmentT struct {
	ID              string  `json:"id"`
	WalletID        string  `json:"walletId"`
	CompetenceMonth string  `json:"competenceMonth"`
	AmountCents     int64   `json:"amountCents"`
	Notes           *string `json:"notes"`
	CreatedAt       string  `json:"createdAt"`
}

// checkBalance confere o saldo de `wallet` informando o saldo real `actual` (extra: competenceMonth, notes).
func (a *app) checkBalance(c *http.Cookie, house, wallet string, actual int64, extra map[string]any) (adjustmentT, resp) {
	a.t.Helper()
	body := map[string]any{"walletId": wallet, "actualBalanceCents": actual}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/wallet-adjustments", body, c)
	var out adjustmentT
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

func (a *app) adjustmentsOf(c *http.Cookie, house, month string) []adjustmentT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/wallet-adjustments?month="+month, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("listar ajustes: %d %s", r.Code, r.Body)
	}
	var out []adjustmentT
	r.json(&out)
	return out
}

// O cenário do plano: a receita de outubro foi lançada, os gastos não. Em outubro a pessoa confere e digita o saldo real:
// a diferença vira um ajuste em outubro, novembro começa do saldo real e excluir o ajuste volta ao calculado.
func TestConferirSaldoNovembroComecaDoSaldoReal(t *testing.T) {
	a, c, house, _ := casa(t) // hoje = 18/10/2026
	geral := a.free(house)
	if _, r := a.postAvulsa(c, house, map[string]any{"description": "Salário", "grossAmountCents": 500000, "walletId": geral}); r.Code != 201 {
		t.Fatal(r.Body)
	}
	if got := a.summaryOf(c, house, "2026-11-01").named("Geral"); got.CarryOverCents != 500000 {
		t.Fatalf("antes de conferir, novembro herda o calculado: %+v", got)
	}

	adj, r := a.checkBalance(c, house, geral, 120000, map[string]any{"notes": "  extrato do banco  "})
	if r.Code != 201 {
		t.Fatalf("conferir: %d %s", r.Code, r.Body)
	}
	if adj.AmountCents != -380000 || adj.CompetenceMonth != "2026-10-01" || adj.WalletID != geral || adj.Notes == nil || *adj.Notes != "extrato do banco" || adj.CreatedAt == "" {
		t.Errorf("ajuste (padrão = mês atual, diferença com sinal): %+v", adj)
	}
	oct := a.summaryOf(c, house, "2026-10-01")
	g := oct.named("Geral")
	if g.AdjustmentsCents != -380000 || g.BalanceCents != 120000 || g.MonthBalanceCents != 120000 || g.ProjectedCents != 120000 {
		t.Errorf("outubro com o ajuste: %+v", g)
	}
	// não é receita nem despesa
	if g.ReceivedIncomeCents != 500000 || g.ExpectedIncomeCents != 500000 || g.PaidCents != 0 || oct.TotalPaidCents != 0 || oct.TotalPendingCents != 0 || len(oct.ByCategory) != 0 {
		t.Errorf("ajuste vazou para receita/despesa: %+v", oct)
	}
	nov := a.summaryOf(c, house, "2026-11-01").named("Geral")
	if nov.CarryOverCents != 120000 || nov.AdjustmentsCents != 0 {
		t.Errorf("novembro deveria começar do saldo real: %+v", nov)
	}
	if got := a.summaryOf(c, house, "2026-12-01").named("Geral"); got.CarryOverCents != 120000 {
		t.Errorf("dezembro acumula: %+v", got)
	}
	// conferir de novo no mesmo mês grava só a nova diferença (o calculado já inclui o primeiro ajuste)
	again, r := a.checkBalance(c, house, geral, 100000, nil)
	if r.Code != 201 || again.AmountCents != -20000 {
		t.Errorf("segunda conferência: %d %+v", r.Code, again)
	}
	if n := len(a.adjustmentsOf(c, house, "2026-10-01")); n != 2 {
		t.Errorf("lista de outubro: %d", n)
	}
	// excluir os dois volta ao calculado
	for _, id := range []string{again.ID, adj.ID} {
		if r := a.do("DELETE", "/api/households/"+house+"/wallet-adjustments/"+id, nil, c); r.Code != 204 {
			t.Fatalf("excluir: %d", r.Code)
		}
	}
	if got := a.summaryOf(c, house, "2026-11-01").named("Geral"); got.CarryOverCents != 500000 {
		t.Errorf("sem ajuste, novembro volta ao calculado: %+v", got)
	}
}

// Mês passado também vale (conferir setembro mexe em setembro e em tudo depois); a outra carteira não muda.
func TestConferirSaldoDeMesPassadoPropagaSoNaCarteira(t *testing.T) {
	a, c, house, _ := casa(t)
	geral, vr := a.free(house), a.vr(house)
	if _, r := a.checkBalance(c, house, geral, 30000, map[string]any{"competenceMonth": "2026-09-01"}); r.Code != 201 {
		t.Fatalf("setembro: %d %s", r.Code, r.Body)
	}
	if got := a.summaryOf(c, house, "2026-09-01").named("Geral"); got.AdjustmentsCents != 30000 || got.BalanceCents != 30000 {
		t.Errorf("setembro: %+v", got)
	}
	oct := a.summaryOf(c, house, "2026-10-01")
	if got := oct.named("Geral"); got.CarryOverCents != 30000 || got.BalanceCents != 30000 || got.AdjustmentsCents != 0 {
		t.Errorf("outubro herda: %+v", got)
	}
	for _, w := range oct.Wallets {
		if w.WalletID == vr && (w.CarryOverCents != 0 || w.BalanceCents != 0) {
			t.Errorf("a outra carteira não muda: %+v", w)
		}
	}
	if n := len(a.adjustmentsOf(c, house, "2026-10-01")); n != 0 {
		t.Errorf("lista de outubro não traz o de setembro: %d", n)
	}
}

func TestConferirSaldoValidacoes(t *testing.T) {
	a, c, house, _ := casa(t)
	_, houseB := a.register("Beto", "beto@x.com", "Casa B")
	geral := a.free(house)
	arq, _ := a.newWallet(c, house, map[string]any{"name": "Velha"})
	a.walletAction(c, house, arq.ID, "archive")
	nova, _ := a.newWallet(c, house, map[string]any{"name": "Nova", "openingBalanceCents": 10000, "openingBalanceMonth": "2026-10-01"})

	_, r := a.checkBalance(c, house, a.free(houseB), 100, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.checkBalance(c, house, fakeID, 100, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.checkBalance(c, house, arq.ID, 100, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.checkBalance(c, house, geral, 100, map[string]any{"competenceMonth": "2026-10-15"})
	assertField(t, r, 400, "competenceMonth")
	_, r = a.checkBalance(c, house, geral, 100, map[string]any{"competenceMonth": "2026-11-01"}) // mês que ainda não chegou
	assertField(t, r, 400, "competenceMonth")
	_, r = a.checkBalance(c, house, nova.ID, 100, map[string]any{"competenceMonth": "2026-09-01"}) // antes do mês de início
	assertField(t, r, 400, "competenceMonth")
	_, r = a.checkBalance(c, house, geral, 0, nil) // o calculado já é 0: nada a ajustar
	assertField(t, r, 400, "actualBalanceCents")
	_, r = a.checkBalance(c, house, nova.ID, 10000, nil) // no mês de início o calculado é o saldo inicial
	assertField(t, r, 400, "actualBalanceCents")
	_, r = a.checkBalance(c, house, geral, 1_000_000_000_001, nil)
	assertField(t, r, 400, "actualBalanceCents")
	_, r = a.checkBalance(c, house, geral, 100, map[string]any{"notes": strings.Repeat("x", 501)})
	assertField(t, r, 400, "notes")
	if n := len(a.adjustmentsOf(c, house, "2026-10-01")); n != 0 {
		t.Errorf("nada deveria ter sido gravado: %d", n)
	}
	if r := a.do("GET", "/api/households/"+house+"/wallet-adjustments?month=2026-10-15", nil, c); r.Code != 400 {
		t.Errorf("mês fora do dia 1: %d", r.Code)
	}
	// saldo real negativo (cheque especial) vale; no mês de início a diferença é contra o saldo inicial
	if adj, r := a.checkBalance(c, house, geral, -5000, nil); r.Code != 201 || adj.AmountCents != -5000 {
		t.Errorf("saldo negativo: %d %s", r.Code, r.Body)
	}
	if adj, r := a.checkBalance(c, house, nova.ID, 12500, nil); r.Code != 201 || adj.AmountCents != 2500 {
		t.Errorf("no mês de início: %d %s", r.Code, r.Body)
	}
	// o banco também recusa carteira de outra casa (FK composta)
	if err := a.db.Exec(`INSERT INTO wallet_adjustments (household_id, wallet_id, competence_month, amount_cents, created_by)
		VALUES (?, ?, '2026-10-01', 100, ?)`, house, a.free(houseB), a.userID("ana@x.com")).Error; err == nil {
		t.Error("FK composta deveria recusar carteira de outra casa")
	}
}

func TestConferirSaldoPermissoesPorPapelEIsolamento(t *testing.T) {
	a, c, house, _ := casa(t)
	davi, _ := a.newUser("Davi", "davi@x.com")
	carla, _ := a.newUser("Carla", "carla@x.com")
	a.join(c, house, "member", davi)
	a.join(c, house, "viewer", carla)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	geral := a.free(house)

	if _, r := a.checkBalance(c, house, geral, 100, nil); r.Code != 201 {
		t.Errorf("admin: %d %s", r.Code, r.Body)
	}
	mine, r := a.checkBalance(davi, house, geral, 300, nil)
	if r.Code != 201 {
		t.Fatalf("member: %d %s", r.Code, r.Body)
	}
	if _, r := a.checkBalance(carla, house, geral, 500, nil); r.Code != 403 || a.code(r) != "read_only" {
		t.Errorf("viewer criando: %d %s", r.Code, r.Body)
	}
	base := "/api/households/" + house + "/wallet-adjustments/" + mine.ID
	if r := a.do("DELETE", base, nil, carla); r.Code != 403 {
		t.Errorf("viewer excluindo: %d", r.Code)
	}
	if n := len(a.adjustmentsOf(carla, house, "2026-10-01")); n != 2 {
		t.Errorf("viewer lista: %d", n)
	}
	if r := a.do("DELETE", base, nil, davi); r.Code != 204 {
		t.Errorf("member excluindo: %d", r.Code)
	}
	if r := a.do("POST", base+"/restore", nil, carla); r.Code != 403 {
		t.Errorf("viewer restaurando: %d", r.Code)
	}
	if r := a.do("POST", base+"/restore", nil, davi); r.Code != 200 {
		t.Errorf("member restaurando: %d", r.Code)
	}

	// isolamento: a casa B não enxerga nem mexe nos da casa A
	if n := len(a.adjustmentsOf(cB, houseB, "2026-10-01")); n != 0 {
		t.Errorf("casa B vê %d ajustes da A", n)
	}
	if r := a.do("GET", "/api/households/"+house+"/wallet-adjustments?month=2026-10-01", nil, cB); r.Code != 404 {
		t.Errorf("listar pela URL alheia: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+houseB+"/wallet-adjustments/"+mine.ID, nil, cB); r.Code != 404 {
		t.Errorf("excluir da A pela casa B: %d", r.Code)
	}
	if r := a.do("POST", "/api/households/"+houseB+"/wallet-adjustments/"+mine.ID+"/restore", nil, cB); r.Code != 404 {
		t.Errorf("restaurar da A pela casa B: %d", r.Code)
	}
	if got := a.summaryOf(cB, houseB, "2026-10-01").named("Geral"); got.AdjustmentsCents != 0 || got.BalanceCents != 0 {
		t.Errorf("saldo da casa B mudou: %+v", got)
	}
	if r := a.do("POST", "/api/households/"+house+"/wallet-adjustments", map[string]any{"walletId": geral, "actualBalanceCents": 1}, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestConferirSaldoExcluirERestaurar(t *testing.T) {
	a, c, house, _ := casa(t)
	adj, _ := a.checkBalance(c, house, a.free(house), 1000, nil)
	base := "/api/households/" + house + "/wallet-adjustments/" + adj.ID
	if r := a.do("POST", base+"/restore", nil, c); r.Code != 409 || a.code(r) != "not_deleted" {
		t.Errorf("restaurar sem estar excluído: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", base, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	if r := a.do("DELETE", base, nil, c); r.Code != 404 {
		t.Errorf("excluir de novo: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+house+"/wallet-adjustments/"+fakeID, nil, c); r.Code != 404 {
		t.Errorf("inexistente: %d", r.Code)
	}
	var back adjustmentT
	r := a.do("POST", base+"/restore", nil, c)
	r.json(&back)
	if r.Code != 200 || back.ID != adj.ID || back.AmountCents != 1000 {
		t.Errorf("restaurar: %d %s", r.Code, r.Body)
	}
	if got := a.summaryOf(c, house, "2026-10-01").named("Geral"); got.BalanceCents != 1000 {
		t.Errorf("restaurado volta a valer: %+v", got)
	}
}

// O aviso de saldo (ao pagar) usa a mesma conta do resumo: um ajuste para baixo faz o pagamento seguinte avisar.
func TestConferirSaldoEntraNoAvisoDeSaldo(t *testing.T) {
	a, c, house, cat := casa(t)
	w, r := a.newWallet(c, house, map[string]any{"name": "Conta", "warnOnOverdraft": true, "openingBalanceCents": 50000})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	pay := func() payResultT {
		t.Helper()
		i, r := a.newInvoice(c, house, cat, map[string]any{"amountCents": 20000, "dueDate": "2026-10-10"})
		if r.Code != 201 {
			t.Fatal(r.Body)
		}
		p, r := a.pay(c, house, i.ID, w.ID, nil)
		if r.Code != 200 {
			t.Fatal(r.Body)
		}
		return p
	}
	if p := pay(); len(p.Warnings) != 0 { // 500 - 200 = 300
		t.Fatalf("sem ajuste não avisa: %+v", p.Warnings)
	}
	if _, r := a.checkBalance(c, house, w.ID, 10000, nil); r.Code != 201 { // o real era 100
		t.Fatal(r.Body)
	}
	if p := pay(); len(p.Warnings) != 1 { // 100 - 200 < 0
		t.Errorf("com o ajuste, deveria avisar: %+v", p.Warnings)
	}
}
