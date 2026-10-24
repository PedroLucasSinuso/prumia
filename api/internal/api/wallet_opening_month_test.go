package api

import (
	"strings"
	"testing"
)

// Cenário real: contas que começaram ANTES de usar o app (parcelas de agosto e setembro, sem as receitas desses meses).
// Com o mês de início em outubro, o saldo inicial (dinheiro real) vale só de outubro em diante e agosto/setembro não
// propagam para a frente.
func TestCarteiraMesDeInicioParcelasAnterioresNaoPropagam(t *testing.T) {
	a, c, house, cat := casa(t) // hoje = 18/10/2026
	w, r := a.newWallet(c, house, map[string]any{"name": "Conta", "warnOnOverdraft": true,
		"openingBalanceCents": 100000, "openingBalanceMonth": "2026-10-01"})
	if r.Code != 201 || w.OpeningBalanceMonth == nil || *w.OpeningBalanceMonth != "2026-10-01" {
		t.Fatalf("criar com mês de início: %d %s", r.Code, r.Body)
	}
	pay := func(due string, cents int64) payResultT {
		t.Helper()
		i, r := a.newInvoice(c, house, cat, map[string]any{"amountCents": cents, "dueDate": due})
		if r.Code != 201 {
			t.Fatal(r.Body)
		}
		p, r := a.pay(c, house, i.ID, w.ID, nil)
		if r.Code != 200 {
			t.Fatal(r.Body)
		}
		return p
	}
	pAgo := pay("2026-08-10", 60000)
	pay("2026-09-10", 60000)

	// antes do início: a carteira "ainda não começou", mas o movimento do próprio mês aparece
	for _, m := range []string{"2026-08-01", "2026-09-01"} {
		got := a.summaryOf(c, house, m).named("Conta")
		if got.CarryOverCents != 0 || got.PaidCents != 60000 || got.BalanceCents != -60000 || got.MonthBalanceCents != -60000 ||
			got.OpeningBalanceMonth == nil || *got.OpeningBalanceMonth != "2026-10-01" {
			t.Errorf("%s: %+v", m, got)
		}
	}
	if len(pAgo.Warnings) != 1 { // dentro do mês antes do início o saldo é negativo e avisa, como o resumo mostra
		t.Errorf("aviso em agosto deveria acompanhar o resumo: %+v", pAgo.Warnings)
	}
	// M = S: só o saldo inicial
	if got := a.summaryOf(c, house, "2026-10-01").named("Conta"); got.CarryOverCents != 100000 || got.BalanceCents != 100000 || got.ProjectedCents != 100000 {
		t.Errorf("outubro: %+v", got)
	}
	// pagar em outubro NÃO avisa (sem o mês de início daria 100 - 60 - 60 - 20 < 0)
	out := pay("2026-10-12", 20000)
	if len(out.Warnings) != 0 {
		t.Errorf("aviso em outubro deveria seguir o saldo do resumo: %+v", out.Warnings)
	}
	// M > S: saldo inicial + movimento de outubro (agosto e setembro nunca entram)
	nov := a.summaryOf(c, house, "2026-11-01").named("Conta")
	if nov.CarryOverCents != 80000 || nov.BalanceCents != 80000 {
		t.Errorf("novembro: %+v", nov)
	}
	if got := a.summaryOf(c, house, "2026-12-01").named("Conta"); got.CarryOverCents != 80000 {
		t.Errorf("dezembro: %+v", got)
	}
	// pagar algo grande em outubro avisa, e o aviso bate com o saldo do resumo
	big := pay("2026-10-15", 90000)
	if sum := a.summaryOf(c, house, "2026-10-01").named("Conta"); sum.BalanceCents != -10000 || len(big.Warnings) != 1 {
		t.Errorf("aviso x resumo: %+v %+v", sum, big.Warnings)
	}
}

// Sem mês de início (NULL) nada muda; limpar com PATCH null volta ao comportamento de sempre.
func TestCarteiraMesDeInicioNuloEPatch(t *testing.T) {
	a, c, house, cat := casa(t)
	w, _ := a.newWallet(c, house, map[string]any{"name": "Conta", "warnOnOverdraft": false, "openingBalanceCents": 100000})
	if w.OpeningBalanceMonth != nil {
		t.Fatalf("padrão deveria ser nulo: %+v", w)
	}
	i, _ := a.newInvoice(c, house, cat, map[string]any{"amountCents": 30000, "dueDate": "2026-08-10"})
	a.pay(c, house, i.ID, w.ID, nil)
	carry := func(m string) int64 { return a.summaryOf(c, house, m).named("Conta").CarryOverCents }
	if carry("2026-09-01") != 70000 || carry("2026-07-01") != 100000 || carry("2026-10-01") != 70000 {
		t.Fatalf("NULL deveria manter o comportamento atual: %d %d %d", carry("2026-07-01"), carry("2026-09-01"), carry("2026-10-01"))
	}
	// definir o mês de início em setembro: agosto sai do carry, e julho/agosto ficam sem saldo inicial
	if got, r := a.patchWallet(c, house, w.ID, map[string]any{"openingBalanceMonth": "2026-09-01"}); r.Code != 200 || got.OpeningBalanceMonth == nil || *got.OpeningBalanceMonth != "2026-09-01" {
		t.Fatalf("patch: %d %s", r.Code, r.Body)
	}
	if carry("2026-07-01") != 0 || carry("2026-08-01") != 0 || carry("2026-09-01") != 100000 || carry("2026-10-01") != 100000 {
		t.Errorf("com início em setembro: %d %d %d %d", carry("2026-07-01"), carry("2026-08-01"), carry("2026-09-01"), carry("2026-10-01"))
	}
	// editar outro campo não mexe no mês de início
	if got, _ := a.patchWallet(c, house, w.ID, map[string]any{"warnOnOverdraft": true}); got.OpeningBalanceMonth == nil {
		t.Errorf("PATCH sem o campo não pode limpar: %+v", got)
	}
	// null limpa
	if got, r := a.patchWallet(c, house, w.ID, map[string]any{"openingBalanceMonth": nil}); r.Code != 200 || got.OpeningBalanceMonth != nil {
		t.Fatalf("limpar: %d %s", r.Code, r.Body)
	}
	if carry("2026-07-01") != 100000 || carry("2026-10-01") != 70000 {
		t.Errorf("depois de limpar: %d %d", carry("2026-07-01"), carry("2026-10-01"))
	}
}

// Receitas e transferências seguem a mesma regra; mês de início depois do último movimento só carrega o saldo inicial.
func TestCarteiraMesDeInicioComReceitasETransferencias(t *testing.T) {
	a, c, house, _ := casa(t)
	w, _ := a.newWallet(c, house, map[string]any{"name": "Conta", "openingBalanceCents": 50000, "openingBalanceMonth": "2026-10-01", "warnOnOverdraft": false})
	outra, _ := a.newWallet(c, house, map[string]any{"name": "Outra", "warnOnOverdraft": false})
	income := func(month, date string, cents int64) {
		t.Helper()
		if _, r := a.postAvulsa(c, house, map[string]any{"competenceMonth": month, "expectedDate": date, "grossAmountCents": cents, "walletId": w.ID}); r.Code != 201 {
			t.Fatal(r.Body)
		}
	}
	income("2026-09-01", "2026-09-05", 10000)
	income("2026-10-01", "2026-10-05", 20000)
	if _, r := a.newTransfer(c, house, w.ID, outra.ID, 3000, map[string]any{"transferDate": "2026-09-20"}); r.Code != 201 {
		t.Fatal(r.Body)
	}
	if _, r := a.newTransfer(c, house, outra.ID, w.ID, 500, map[string]any{"transferDate": "2026-11-02"}); r.Code != 201 {
		t.Fatal(r.Body)
	}
	set, out := a.summaryOf(c, house, "2026-09-01").named("Conta"), a.summaryOf(c, house, "2026-10-01").named("Conta")
	nov, dez := a.summaryOf(c, house, "2026-11-01").named("Conta"), a.summaryOf(c, house, "2026-12-01").named("Conta")
	if set.CarryOverCents != 0 || set.BalanceCents != 7000 { // 10000 - 3000 do próprio mês
		t.Errorf("setembro: %+v", set)
	}
	if out.CarryOverCents != 50000 || out.BalanceCents != 70000 {
		t.Errorf("outubro: %+v", out)
	}
	if nov.CarryOverCents != 70000 || nov.BalanceCents != 70500 || dez.CarryOverCents != 70500 {
		t.Errorf("novembro/dezembro: %+v %+v", nov, dez)
	}
	// a carteira "Outra" (sem mês) segue a regra de sempre: recebeu 30 em setembro
	if o := a.summaryOf(c, house, "2026-10-01").named("Outra"); o.CarryOverCents != 3000 {
		t.Errorf("outra: %+v", o)
	}
	// início depois do último movimento (dezembro): meses anteriores zerados, dezembro = só o saldo inicial
	a.patchWallet(c, house, w.ID, map[string]any{"openingBalanceMonth": "2026-12-01"})
	for m, want := range map[string]int64{"2026-10-01": 0, "2026-11-01": 0, "2026-12-01": 50000, "2027-01-01": 50000} {
		if got := a.summaryOf(c, house, m).named("Conta").CarryOverCents; got != want {
			t.Errorf("início em dezembro, %s: carry %d, quer %d", m, got, want)
		}
	}
}

func TestCarteiraMesDeInicioValidacaoEIsolamento(t *testing.T) {
	a, c, house, _ := casa(t)
	if _, r := a.newWallet(c, house, map[string]any{"name": "X", "openingBalanceMonth": "2026-10-15"}); r.Code != 400 || !strings.Contains(r.Body.String(), "openingBalanceMonth") {
		t.Errorf("dia 15 na criação: %d %s", r.Code, r.Body)
	}
	w, _ := a.newWallet(c, house, map[string]any{"name": "Y"})
	if _, r := a.patchWallet(c, house, w.ID, map[string]any{"openingBalanceMonth": "2026-10-02"}); r.Code != 400 || !strings.Contains(r.Body.String(), "openingBalanceMonth") {
		t.Errorf("dia 2 no patch: %d %s", r.Code, r.Body)
	}
	// outra casa não mexe na carteira desta
	cb, houseB := a.register("Bia", "bia@x.com", "Casa B")
	if _, r := a.patchWallet(cb, houseB, w.ID, map[string]any{"openingBalanceMonth": "2026-10-01"}); r.Code != 404 {
		t.Errorf("outra casa deveria receber 404: %d %s", r.Code, r.Body)
	}
}
