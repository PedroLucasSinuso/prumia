package api

import (
	"testing"
)

// Investimento é uma carteira especial: aporte e resgate são transferências; o rendimento entra pelo Conferir saldo.
// Não paga conta, não recebe receita, não vira carteira padrão (nem da casa nem de categoria).
func TestInvestimentoComoCarteiraEspecial(t *testing.T) {
	a, c, house, catID := casa(t) // hoje = 18/10/2026
	geral := a.free(house)

	_, r := a.newWallet(c, house, map[string]any{"name": "Errada", "kind": "acoes"})
	assertField(t, r, 400, "kind")
	_, r = a.newWallet(c, house, map[string]any{"name": "Errada", "kind": "investment", "institution": "Banco Fictício de Investimentos e Participações Sociedade Anônima"})
	assertField(t, r, 400, "institution")

	cdb, r := a.newWallet(c, house, map[string]any{"name": "CDB", "kind": "investment", "institution": "  Banco Fictício  "})
	if r.Code != 201 {
		t.Fatalf("criar investimento: %d %s", r.Code, r.Body)
	}
	if cdb.Kind != "investment" || cdb.Institution == nil || *cdb.Institution != "Banco Fictício" {
		t.Errorf("investimento criado: %+v", cdb)
	}
	if ws := a.wallets(c, house, false); ws[0].Kind != "regular" {
		t.Errorf("carteira comum deveria ser regular: %+v", ws[0])
	}

	// não paga conta, não recebe receita, não é padrão de categoria nem da casa
	i, r := a.newInvoice(c, house, catID, map[string]any{"amountCents": 5000, "dueDate": "2026-10-20"})
	if r.Code != 201 {
		t.Fatal(r.Body)
	}
	_, r = a.pay(c, house, i.ID, cdb.ID, nil)
	assertField(t, r, 400, "walletId")
	_, r = a.postIncome(c, house, map[string]any{"walletId": cdb.ID})
	assertField(t, r, 400, "walletId")
	r = a.do("PATCH", "/api/households/"+house+"/categories/"+catID, map[string]any{"defaultWalletId": cdb.ID}, c)
	assertField(t, r, 400, "defaultWalletId")
	_, r = a.patchWallet(c, house, cdb.ID, map[string]any{"isDefault": true})
	assertField(t, r, 400, "isDefault")

	// aporte (transferência da Geral) e rendimento (Conferir saldo)
	if _, r := a.newTransfer(c, house, geral, cdb.ID, 100000, nil); r.Code != 201 {
		t.Fatalf("aporte: %d %s", r.Code, r.Body)
	}
	if _, r := a.checkBalance(c, house, cdb.ID, 101500, nil); r.Code != 201 {
		t.Fatalf("rendimento: %d %s", r.Code, r.Body)
	}
	s := a.summaryOf(c, house, "2026-10-01")
	inv := s.named("CDB")
	if inv.Kind != "investment" || inv.TransfersInCents != 100000 || inv.AdjustmentsCents != 1500 || inv.BalanceCents != 101500 {
		t.Errorf("investimento no resumo: %+v", inv)
	}
	if s.Free().Kind != "regular" || s.Free().TransfersOutCents != 100000 {
		t.Errorf("geral no resumo: %+v", s.Free())
	}
	// resgate parcial volta para a Geral
	if _, r := a.newTransfer(c, house, cdb.ID, geral, 20000, nil); r.Code != 201 {
		t.Fatalf("resgate: %d %s", r.Code, r.Body)
	}
	if got := a.summaryOf(c, house, "2026-10-01").named("CDB").BalanceCents; got != 81500 {
		t.Errorf("saldo depois do resgate = %d, quer 81500", got)
	}

	// limpar a instituição
	w, r := a.patchWallet(c, house, cdb.ID, map[string]any{"institution": nil})
	if r.Code != 200 || w.Institution != nil || w.Kind != "investment" {
		t.Errorf("limpar instituição: %d %+v", r.Code, w)
	}
}
