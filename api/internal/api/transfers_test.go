package api

import (
	"net/http"
	"strings"
	"testing"
)

type transferT struct {
	ID              string  `json:"id"`
	FromWalletID    string  `json:"fromWalletId"`
	ToWalletID      string  `json:"toWalletId"`
	AmountCents     int64   `json:"amountCents"`
	TransferDate    string  `json:"transferDate"`
	CompetenceMonth string  `json:"competenceMonth"`
	Notes           *string `json:"notes"`
}

type transferResultT struct {
	Transfer       transferT `json:"transfer"`
	Warnings       []string  `json:"warnings"`
	WarningDetails []struct {
		Code     string `json:"code"`
		WalletID string `json:"walletId"`
	} `json:"warningDetails"`
}

func (a *app) newTransfer(c *http.Cookie, house, from, to string, cents int64, extra map[string]any) (transferResultT, resp) {
	a.t.Helper()
	body := map[string]any{"fromWalletId": from, "toWalletId": to, "amountCents": cents}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/transfers", body, c)
	var out transferResultT
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

func (a *app) transfersOf(c *http.Cookie, house, month string) []transferT {
	a.t.Helper()
	r := a.do("GET", "/api/households/"+house+"/transfers?month="+month, nil, c)
	if r.Code != http.StatusOK {
		a.t.Fatalf("listar transferências: %d %s", r.Code, r.Body)
	}
	var out []transferT
	r.json(&out)
	return out
}

func TestTransferenciaCriaComPadroesEListaDoMes(t *testing.T) {
	a, c, house, _ := casa(t) // hoje = 18/10/2026
	reserva, _ := a.newWallet(c, house, map[string]any{"name": "Reserva"})
	res, r := a.newTransfer(c, house, a.free(house), reserva.ID, 50000, map[string]any{"notes": "  guardar  "})
	if r.Code != 201 {
		t.Fatalf("criar: %d %s", r.Code, r.Body)
	}
	tr := res.Transfer
	if tr.TransferDate != "2026-10-18" || tr.CompetenceMonth != "2026-10-01" || tr.AmountCents != 50000 || tr.Notes == nil || *tr.Notes != "guardar" {
		t.Errorf("padrões: %+v", tr)
	}
	// outra, com data de outubro mais antiga e uma de novembro
	a.newTransfer(c, house, reserva.ID, a.free(house), 1000, map[string]any{"transferDate": "2026-10-02"})
	a.newTransfer(c, house, a.free(house), reserva.ID, 2000, map[string]any{"transferDate": "2026-11-03"})
	got := a.transfersOf(c, house, "2026-10-01")
	if len(got) != 2 || got[0].TransferDate != "2026-10-18" || got[1].TransferDate != "2026-10-02" {
		t.Errorf("lista de outubro (data desc): %+v", got)
	}
	if n := len(a.transfersOf(c, house, "2026-11-01")); n != 1 {
		t.Errorf("lista de novembro: %d", n)
	}
	// competência diferente do mês da data
	x, r := a.newTransfer(c, house, a.free(house), reserva.ID, 300, map[string]any{"transferDate": "2026-10-30", "competenceMonth": "2026-11-01"})
	if r.Code != 201 || x.Transfer.CompetenceMonth != "2026-11-01" {
		t.Errorf("competência explícita: %d %s", r.Code, r.Body)
	}
	if r := a.do("GET", "/api/households/"+house+"/transfers?month=2026-10-15", nil, c); r.Code != 400 {
		t.Errorf("mês fora do dia 1: %d", r.Code)
	}
}

func TestTransferenciaValidacoes(t *testing.T) {
	a, c, house, _ := casa(t)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	_ = cB
	geral, vr := a.free(house), a.vr(house)
	arq, _ := a.newWallet(c, house, map[string]any{"name": "Velha"})
	a.walletAction(c, house, arq.ID, "archive")

	_, r := a.newTransfer(c, house, geral, geral, 100, nil)
	assertField(t, r, 400, "toWalletId")
	_, r = a.newTransfer(c, house, geral, vr, 0, nil)
	assertField(t, r, 400, "amountCents")
	_, r = a.newTransfer(c, house, geral, vr, -5, nil)
	assertField(t, r, 400, "amountCents")
	_, r = a.newTransfer(c, house, geral, vr, 1_000_000_000_001, nil)
	assertField(t, r, 400, "amountCents")
	_, r = a.newTransfer(c, house, a.free(houseB), vr, 100, nil)
	assertField(t, r, 400, "fromWalletId")
	_, r = a.newTransfer(c, house, geral, a.vr(houseB), 100, nil)
	assertField(t, r, 400, "toWalletId")
	_, r = a.newTransfer(c, house, geral, fakeID, 100, nil)
	assertField(t, r, 400, "toWalletId")
	_, r = a.newTransfer(c, house, arq.ID, vr, 100, nil)
	assertField(t, r, 400, "fromWalletId")
	_, r = a.newTransfer(c, house, geral, arq.ID, 100, nil)
	assertField(t, r, 400, "toWalletId")
	_, r = a.newTransfer(c, house, geral, vr, 100, map[string]any{"competenceMonth": "2026-10-15"})
	assertField(t, r, 400, "competenceMonth")
	_, r = a.newTransfer(c, house, geral, vr, 100, map[string]any{"notes": strings.Repeat("x", 501)})
	assertField(t, r, 400, "notes")
	if n := len(a.transfersOf(c, house, "2026-10-01")); n != 0 {
		t.Errorf("nada deveria ter sido gravado: %d", n)
	}
	// o banco também recusa (defesa em profundidade): mesma carteira e carteira de outra casa
	if err := a.db.Exec(`INSERT INTO wallet_transfers (household_id, from_wallet_id, to_wallet_id, amount_cents, transfer_date, competence_month, created_by)
		VALUES (?, ?, ?, 100, '2026-10-01', '2026-10-01', ?)`, house, geral, a.vr(houseB), a.userID("ana@x.com")).Error; err == nil {
		t.Error("FK composta deveria recusar carteira de outra casa")
	}
	if err := a.db.Exec(`INSERT INTO wallet_transfers (household_id, from_wallet_id, to_wallet_id, amount_cents, transfer_date, competence_month, created_by)
		VALUES (?, ?, ?, 100, '2026-10-01', '2026-10-01', ?)`, house, geral, geral, a.userID("ana@x.com")).Error; err == nil {
		t.Error("CHECK deveria recusar origem = destino")
	}
}

func TestTransferenciaPermissoesPorPapelEIsolamento(t *testing.T) {
	a, c, house, _ := casa(t)
	davi, _ := a.newUser("Davi", "davi@x.com")
	carla, _ := a.newUser("Carla", "carla@x.com")
	a.join(c, house, "member", davi)
	a.join(c, house, "viewer", carla)
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	geral, vr := a.free(house), a.vr(house)

	// admin e member criam; viewer lê, mas nunca escreve
	if _, r := a.newTransfer(c, house, geral, vr, 100, nil); r.Code != 201 {
		t.Errorf("admin: %d", r.Code)
	}
	mine, r := a.newTransfer(davi, house, geral, vr, 200, nil)
	if r.Code != 201 {
		t.Fatalf("member: %d %s", r.Code, r.Body)
	}
	if _, r := a.newTransfer(carla, house, geral, vr, 300, nil); r.Code != 403 || a.code(r) != "read_only" {
		t.Errorf("viewer criando: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", "/api/households/"+house+"/transfers/"+mine.Transfer.ID, nil, carla); r.Code != 403 {
		t.Errorf("viewer excluindo: %d", r.Code)
	}
	if n := len(a.transfersOf(carla, house, "2026-10-01")); n != 2 {
		t.Errorf("viewer lista: %d", n)
	}
	// member exclui e restaura
	if r := a.do("DELETE", "/api/households/"+house+"/transfers/"+mine.Transfer.ID, nil, davi); r.Code != 204 {
		t.Errorf("member excluindo: %d", r.Code)
	}
	if r := a.do("POST", "/api/households/"+house+"/transfers/"+mine.Transfer.ID+"/restore", nil, carla); r.Code != 403 {
		t.Errorf("viewer restaurando: %d", r.Code)
	}
	if r := a.do("POST", "/api/households/"+house+"/transfers/"+mine.Transfer.ID+"/restore", nil, davi); r.Code != 200 {
		t.Errorf("member restaurando: %d", r.Code)
	}

	// isolamento: a casa B não enxerga nem mexe nas da casa A
	if n := len(a.transfersOf(cB, houseB, "2026-10-01")); n != 0 {
		t.Errorf("casa B vê %d transferências da A", n)
	}
	if r := a.do("GET", "/api/households/"+house+"/transfers?month=2026-10-01", nil, cB); r.Code != 404 {
		t.Errorf("listar pela URL alheia: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+houseB+"/transfers/"+mine.Transfer.ID, nil, cB); r.Code != 404 {
		t.Errorf("excluir da A pela casa B: %d", r.Code)
	}
	if r := a.do("POST", "/api/households/"+houseB+"/transfers/"+mine.Transfer.ID+"/restore", nil, cB); r.Code != 404 {
		t.Errorf("restaurar da A pela casa B: %d", r.Code)
	}
	if n := len(a.transfersOf(c, house, "2026-10-01")); n != 2 {
		t.Errorf("casa A deveria manter 2: %d", n)
	}
	if r := a.do("POST", "/api/households/"+house+"/transfers", map[string]any{"fromWalletId": geral, "toWalletId": vr, "amountCents": 1}, nil); r.Code != 401 {
		t.Errorf("sem login: %d", r.Code)
	}
}

func TestTransferenciaExcluirERestaurar(t *testing.T) {
	a, c, house, _ := casa(t)
	res, _ := a.newTransfer(c, house, a.free(house), a.vr(house), 1000, nil)
	base := "/api/households/" + house + "/transfers/" + res.Transfer.ID
	if r := a.do("POST", base+"/restore", nil, c); r.Code != 409 || a.code(r) != "not_deleted" {
		t.Errorf("restaurar sem estar excluída: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", base, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	if n := len(a.transfersOf(c, house, "2026-10-01")); n != 0 {
		t.Errorf("excluída ainda na lista: %d", n)
	}
	if r := a.do("DELETE", base, nil, c); r.Code != 404 {
		t.Errorf("excluir de novo: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+house+"/transfers/"+fakeID, nil, c); r.Code != 404 {
		t.Errorf("inexistente: %d", r.Code)
	}
	var back transferT
	r := a.do("POST", base+"/restore", nil, c)
	r.json(&back)
	if r.Code != 200 || back.ID != res.Transfer.ID || back.AmountCents != 1000 {
		t.Errorf("restaurar: %d %s", r.Code, r.Body)
	}
	if n := len(a.transfersOf(c, house, "2026-10-01")); n != 1 {
		t.Errorf("restaurada deveria voltar à lista: %d", n)
	}
	// não há edição
	if r := a.do("PATCH", base, map[string]any{"amountCents": 1}, c); r.Code == 200 {
		t.Errorf("PATCH não deveria existir: %d", r.Code)
	}
}

// Transferência só move saldo: mês, saldo anterior acumulando, projetado; nunca receita, despesa nem categoria.
func TestTransferenciaAfetaSoOsSaldos(t *testing.T) {
	a, c, house, cat, _ := serie(t) // hoje = 18/10/2026
	reserva, _ := a.newWallet(c, house, map[string]any{"name": "Reserva", "warnOnOverdraft": false})
	geral := a.free(house)
	if _, r := a.postAvulsa(c, house, map[string]any{"description": "Entrada", "competenceMonth": "2026-10-01", "expectedDate": "2026-10-05", "grossAmountCents": 500000, "walletId": geral}); r.Code != 201 {
		t.Fatal(r.Body)
	}
	pend, _ := a.newInvoice(c, house, cat, map[string]any{"amountCents": 70000, "dueDate": "2026-10-25"}) // a pagar, estimada na Geral
	_ = pend
	paga, _ := a.newInvoice(c, house, cat, map[string]any{"amountCents": 100000, "dueDate": "2026-10-10"})
	a.pay(c, house, paga.ID, geral, nil)
	before := a.summaryOf(c, house, "2026-10-01")

	// guardar 500 no mês (out) e 200 em setembro (carry)
	if _, r := a.newTransfer(c, house, geral, reserva.ID, 50000, nil); r.Code != 201 {
		t.Fatal(r.Body)
	}
	ago, r := a.newTransfer(c, house, geral, reserva.ID, 20000, map[string]any{"transferDate": "2026-09-10"})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	s := a.summaryOf(c, house, "2026-10-01")
	g, rs := s.named("Geral"), s.named("Reserva")
	// Geral: anterior -200; recebido 5000 - pago 1000 - enviado 500 => saldo 3300; mês 3500; projetado -200+5000-1000-700-500 = 2600
	if g.CarryOverCents != -20000 || g.TransfersOutCents != 50000 || g.TransfersInCents != 0 || g.BalanceCents != 330000 || g.MonthBalanceCents != 350000 || g.ProjectedCents != 260000 {
		t.Errorf("Geral: %+v", g)
	}
	if rs.CarryOverCents != 20000 || rs.TransfersInCents != 50000 || rs.BalanceCents != 70000 || rs.MonthBalanceCents != 50000 || rs.ProjectedCents != 70000 {
		t.Errorf("Reserva: %+v", rs)
	}
	// não é receita nem despesa
	if g.ExpectedIncomeCents != 500000 || g.ReceivedIncomeCents != 500000 || g.PaidCents != 100000 || rs.ExpectedIncomeCents != 0 || rs.PaidCents != 0 {
		t.Errorf("receita/despesa mudaram: %+v %+v", g, rs)
	}
	if s.TotalPaidCents != before.TotalPaidCents || s.TotalPendingCents != before.TotalPendingCents || len(s.ByCategory) != len(before.ByCategory) {
		t.Errorf("totais/categorias mudaram: %+v vs %+v", s, before)
	}
	for i := range s.ByCategory {
		if s.ByCategory[i] != before.ByCategory[i] {
			t.Errorf("categoria mudou: %+v", s.ByCategory[i])
		}
	}
	// meses seguintes carregam o líquido das transferências (-700 na Geral, +700 na Reserva)
	nov := a.summaryOf(c, house, "2026-11-01")
	if nov.named("Geral").CarryOverCents != 330000 || nov.named("Reserva").CarryOverCents != 70000 {
		t.Errorf("novembro: %+v %+v", nov.named("Geral"), nov.named("Reserva"))
	}
	// setembro só vê a sua (competência)
	set := a.summaryOf(c, house, "2026-09-01")
	if set.named("Geral").TransfersOutCents != 20000 || set.named("Geral").BalanceCents != -20000 || set.named("Reserva").BalanceCents != 20000 {
		t.Errorf("setembro: %+v %+v", set.named("Geral"), set.named("Reserva"))
	}
	// excluir devolve o saldo; restaurar (Desfazer) aplica de novo
	a.do("DELETE", "/api/households/"+house+"/transfers/"+ago.Transfer.ID, nil, c)
	if g := a.summaryOf(c, house, "2026-10-01").named("Geral"); g.CarryOverCents != 0 {
		t.Errorf("sem a de setembro: %+v", g)
	}
	a.do("POST", "/api/households/"+house+"/transfers/"+ago.Transfer.ID+"/restore", nil, c)
	if g := a.summaryOf(c, house, "2026-10-01").named("Geral"); g.CarryOverCents != -20000 {
		t.Errorf("restaurada: %+v", g)
	}
}

// Carteira arquivada continua valendo nas transferências antigas e aparece no resumo do mês com transferência.
func TestTransferenciaComCarteiraArquivada(t *testing.T) {
	a, c, house, _ := casa(t)
	reserva, _ := a.newWallet(c, house, map[string]any{"name": "Reserva"})
	if _, r := a.newTransfer(c, house, a.free(house), reserva.ID, 1000, nil); r.Code != 201 {
		t.Fatal(r.Body)
	}
	// antes de ter qualquer outra coisa: o resumo de outubro mostra a Reserva (ativa)
	if _, r := a.walletAction(c, house, reserva.ID, "archive"); r.Code != 200 {
		t.Fatal(r.Body)
	}
	s := a.summaryOf(c, house, "2026-10-01")
	if w := s.named("Reserva"); !w.Archived || w.TransfersInCents != 1000 || w.BalanceCents != 1000 {
		t.Errorf("arquivada com transferência no mês: %+v", w)
	}
	// um mês antes (sem saldo nem movimento), ela some do resumo
	if w := a.summaryOf(c, house, "2026-08-01").named("Reserva"); w.WalletID != "" {
		t.Errorf("arquivada sem movimento não deveria aparecer: %+v", w)
	}
	// a antiga continua na lista e pode ser excluída/restaurada; nova com arquivada é recusada
	got := a.transfersOf(c, house, "2026-10-01")
	if len(got) != 1 {
		t.Fatalf("lista: %+v", got)
	}
	base := "/api/households/" + house + "/transfers/" + got[0].ID
	if r := a.do("DELETE", base, nil, c); r.Code != 204 {
		t.Errorf("excluir antiga: %d", r.Code)
	}
	if r := a.do("POST", base+"/restore", nil, c); r.Code != 200 {
		t.Errorf("restaurar antiga: %d", r.Code)
	}
	_, r := a.newTransfer(c, house, reserva.ID, a.free(house), 500, nil)
	assertField(t, r, 400, "fromWalletId")
}

func TestTransferenciaAvisaSaldoDaOrigem(t *testing.T) {
	a, c, house, _ := casa(t)
	reserva, _ := a.newWallet(c, house, map[string]any{"name": "Reserva"}) // avisa por padrão
	geral := a.free(house)                                                 // Geral nasce sem aviso

	// Geral (sem aviso) fica negativa: não avisa
	res, r := a.newTransfer(c, house, geral, reserva.ID, 10000, nil)
	if r.Code != 201 || len(res.Warnings) != 0 || res.Warnings == nil {
		t.Errorf("Geral sem aviso: %d %s", r.Code, r.Body)
	}
	// a Reserva tem 100; tirar 60 não avisa, tirar mais 60 estoura e avisa (sem bloquear)
	res, r = a.newTransfer(c, house, reserva.ID, geral, 6000, nil)
	if r.Code != 201 || len(res.Warnings) != 0 {
		t.Errorf("ainda positiva: %d %s", r.Code, r.Body)
	}
	res, r = a.newTransfer(c, house, reserva.ID, geral, 6000, nil)
	if r.Code != 201 || len(res.Warnings) != 1 || res.Warnings[0] != "wallet_balance_insufficient" ||
		len(res.WarningDetails) != 1 || res.WarningDetails[0].WalletID != reserva.ID || res.WarningDetails[0].Code != "wallet_balance_insufficient" {
		t.Errorf("deveria avisar a origem: %d %s", r.Code, r.Body)
	}
	if n := len(a.transfersOf(c, house, "2026-10-01")); n != 3 {
		t.Errorf("o aviso nunca bloqueia: %d", n)
	}
	// ligando o aviso da Geral, tirar dela avisa
	a.patchWallet(c, house, geral, map[string]any{"warnOnOverdraft": true})
	res, _ = a.newTransfer(c, house, geral, reserva.ID, 2500, nil) // a Geral tem +2000: fica em -500
	if len(res.Warnings) != 1 || res.WarningDetails[0].WalletID != geral {
		t.Errorf("Geral com aviso ligado: %+v", res)
	}
}
