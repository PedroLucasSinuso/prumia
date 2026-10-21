package api

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

// "hoje" fixo dos testes: 18/10/2026.
var today = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

type inv struct {
	ID              string `json:"id"`
	CategoryID      string `json:"categoryId"`
	Description     string `json:"description"`
	AmountCents     int64  `json:"amountCents"`
	DueDate         string `json:"dueDate"`
	CompetenceMonth string `json:"competenceMonth"`
	Status          string `json:"status"`
	Notes           *string
	ResponsibleUser *string `json:"responsibleUserId"`
	Paid            *struct {
		PaidAt      string `json:"paidAt"`
		Wallet      string `json:"wallet"`
		AmountCents int64  `json:"amountCents"`
		PaidBy      string `json:"paidByUserId"`
	} `json:"paid"`
}

type cat struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	DefaultWallet *string `json:"defaultWallet"`
	IsEssential   bool    `json:"isEssential"`
	Archived      bool    `json:"archived"`
}

// casa prepara um app com relógio fixo, uma conta e a primeira categoria da casa.
func casa(t *testing.T) (a *app, c *http.Cookie, house, catID string) {
	t.Helper()
	a = newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	c, house = a.register("Ana", "ana@x.com", "Casa A")
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	return a, c, house, cats[0].ID
}

func (a *app) newInvoice(c *http.Cookie, house, catID string, extra map[string]any) (inv, resp) {
	a.t.Helper()
	body := map[string]any{"categoryId": catID, "description": "Aluguel", "amountCents": 150000, "dueDate": "2026-10-20"}
	for k, v := range extra {
		body[k] = v
	}
	r := a.do("POST", "/api/households/"+house+"/invoices", body, c)
	var i inv
	if r.Code == http.StatusCreated {
		r.json(&i)
	}
	return i, r
}

func TestCategorias(t *testing.T) {
	a, c, house, _ := casa(t)
	base := "/api/households/" + house + "/categories"

	var cats []cat
	a.do("GET", base, nil, c).json(&cats)
	if len(cats) != 10 || cats[0].Name != "Moradia" || cats[1].DefaultWallet == nil || *cats[1].DefaultWallet != "benefit" {
		t.Fatalf("categorias padrão: %+v", cats)
	}

	// criar, duplicada (sem caixa), validação
	r := a.do("POST", base, map[string]any{"name": "Pets", "defaultWallet": "free", "isEssential": true}, c)
	var pets cat
	r.json(&pets)
	if r.Code != 201 || pets.Name != "Pets" || !pets.IsEssential {
		t.Fatalf("criar: %d %s", r.Code, r.Body)
	}
	if r := a.do("POST", base, map[string]any{"name": "pets"}, c); r.Code != 409 {
		t.Errorf("duplicada deveria ser 409: %d", r.Code)
	}
	if r := a.do("POST", base, map[string]any{"name": " "}, c); r.Code != 400 {
		t.Errorf("nome vazio: %d", r.Code)
	}
	if r := a.do("POST", base, map[string]any{"name": "X", "defaultWallet": "ouro"}, c); r.Code != 400 {
		t.Errorf("carteira inválida: %d", r.Code)
	}

	// editar: renomear, limpar defaultWallet com null, e distinguir "ausente" de "null"
	r = a.do("PATCH", base+"/"+pets.ID, map[string]any{"name": "Animais", "defaultWallet": nil}, c)
	var upd cat
	r.json(&upd)
	if r.Code != 200 || upd.Name != "Animais" || upd.DefaultWallet != nil {
		t.Fatalf("editar: %d %s", r.Code, r.Body)
	}
	r = a.do("PATCH", base+"/"+pets.ID, map[string]any{"defaultWallet": "benefit"}, c)
	r.json(&upd)
	r = a.do("PATCH", base+"/"+pets.ID, map[string]any{"isEssential": false}, c) // ausente: não mexe na carteira
	r.json(&upd)
	if upd.DefaultWallet == nil || *upd.DefaultWallet != "benefit" || upd.IsEssential {
		t.Errorf("campo ausente não pode limpar: %+v", upd)
	}

	// arquivar esconde da lista padrão; includeArchived mostra
	a.do("PATCH", base+"/"+pets.ID, map[string]any{"archived": true}, c)
	a.do("GET", base, nil, c).json(&cats)
	if len(cats) != 10 {
		t.Errorf("arquivada deve sumir da lista: %d", len(cats))
	}
	a.do("GET", base+"?includeArchived=true", nil, c).json(&cats)
	if len(cats) != 11 {
		t.Errorf("includeArchived: %d", len(cats))
	}
	// arquivada não aceita invoice nova
	if _, r := a.newInvoice(c, house, pets.ID, nil); r.Code != 400 {
		t.Errorf("invoice em categoria arquivada: %d", r.Code)
	}
	// desarquivar
	a.do("PATCH", base+"/"+pets.ID, map[string]any{"archived": false}, c)

	// excluir: livre pode; em uso não (409), e dá para arquivar
	if r := a.do("DELETE", base+"/"+pets.ID, nil, c); r.Code != 204 {
		t.Errorf("excluir categoria sem uso: %d", r.Code)
	}
	if r := a.do("GET", base+"/"+pets.ID, nil, c); r.Code != 404 && r.Code != 501 {
		t.Logf("(sem GET por id no contrato: %d)", r.Code)
	}
	_, ri := a.newInvoice(c, house, cats[0].ID, nil)
	if ri.Code != 201 {
		t.Fatal(ri.Body)
	}
	if r := a.do("DELETE", base+"/"+cats[0].ID, nil, c); r.Code != 409 {
		t.Errorf("categoria em uso deveria ser 409: %d", r.Code)
	}
}

func TestCategoriaDeOutraCasaNaoVale(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	cA, houseA := a.register("Ana", "ana@x.com", "A")
	cB, houseB := a.register("Beto", "beto@x.com", "B")
	var catsB []cat
	a.do("GET", "/api/households/"+houseB+"/categories", nil, cB).json(&catsB)

	// Ana tenta mexer na categoria do Beto pela própria casa: 404
	if r := a.do("PATCH", "/api/households/"+houseA+"/categories/"+catsB[0].ID, map[string]any{"name": "Hack"}, cA); r.Code != 404 {
		t.Errorf("editar categoria alheia: %d", r.Code)
	}
	if r := a.do("DELETE", "/api/households/"+houseA+"/categories/"+catsB[0].ID, nil, cA); r.Code != 404 {
		t.Errorf("excluir categoria alheia: %d", r.Code)
	}
	// e não consegue usá-la numa invoice
	_, r := a.newInvoice(cA, houseA, catsB[0].ID, nil)
	if r.Code != 400 {
		t.Errorf("invoice com categoria de outra casa: %d %s", r.Code, r.Body)
	}
}

func TestInvoiceCriarEValidar(t *testing.T) {
	a, c, house, catID := casa(t)
	i, r := a.newInvoice(c, house, catID, map[string]any{"notes": "  ref. outubro  "})
	if r.Code != 201 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	if i.Status != "pending" || i.CompetenceMonth != "2026-10-01" || i.AmountCents != 150000 || i.Notes == nil || *i.Notes != "ref. outubro" {
		t.Errorf("invoice criada: %+v", i)
	}
	// vencimento passado => atrasada (estado derivado)
	late, _ := a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-10-10"})
	if late.Status != "overdue" {
		t.Errorf("status = %s, quer overdue", late.Status)
	}
	// competência diferente do vencimento (conta de outubro paga em novembro)
	other, _ := a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-11-05", "competenceMonth": "2026-10-01"})
	if other.CompetenceMonth != "2026-10-01" || other.DueDate != "2026-11-05" {
		t.Errorf("competência explícita: %+v", other)
	}

	// validações por campo
	_, r = a.newInvoice(c, house, catID, map[string]any{"description": " ", "amountCents": 0, "competenceMonth": "2026-10-15"})
	var p problemBody
	r.json(&p)
	if r.Code != 400 || p.Code != "validation_error" {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	for _, f := range []string{"description", "amountCents", "competenceMonth"} {
		if p.Fields[f] == "" {
			t.Errorf("faltou erro em %s: %v", f, p.Fields)
		}
	}
	if _, r := a.newInvoice(c, house, catID, map[string]any{"dueDate": "2026-02-30"}); r.Code != 400 {
		t.Errorf("data inexistente: %d", r.Code)
	}
	if _, r := a.newInvoice(c, house, catID, map[string]any{"amountCents": -5}); r.Code != 400 {
		t.Errorf("valor negativo: %d", r.Code)
	}
	// responsável tem de ser membro da casa
	cB, _ := a.register("Beto", "beto@x.com", "Outra")
	_ = cB
	var betoID string
	a.db.Raw("SELECT id::text FROM users WHERE email='beto@x.com'").Scan(&betoID)
	if _, r := a.newInvoice(c, house, catID, map[string]any{"responsibleUserId": betoID}); r.Code != 400 {
		t.Errorf("responsável de fora: %d", r.Code)
	}
	var anaID string
	a.db.Raw("SELECT id::text FROM users WHERE email='ana@x.com'").Scan(&anaID)
	if i, r := a.newInvoice(c, house, catID, map[string]any{"responsibleUserId": anaID}); r.Code != 201 || i.ResponsibleUser == nil {
		t.Errorf("responsável membro: %d", r.Code)
	}
}

func TestInvoiceEditarLimparEExcluir(t *testing.T) {
	a, c, house, catID := casa(t)
	var anaID string
	a.db.Raw("SELECT id::text FROM users WHERE email='ana@x.com'").Scan(&anaID)
	i, _ := a.newInvoice(c, house, catID, map[string]any{"notes": "nota", "responsibleUserId": anaID})
	url := "/api/households/" + house + "/invoices/" + i.ID

	var got inv
	r := a.do("PATCH", url, map[string]any{"description": "Aluguel de outubro", "amountCents": 160000}, c)
	r.json(&got)
	if r.Code != 200 || got.Description != "Aluguel de outubro" || got.AmountCents != 160000 || got.Notes == nil || got.ResponsibleUser == nil {
		t.Fatalf("editar: %d %s", r.Code, r.Body)
	}
	// null limpa; ausente preserva
	r = a.do("PATCH", url, map[string]any{"notes": nil, "responsibleUserId": nil}, c)
	got = inv{}
	r.json(&got)
	if got.Notes != nil || got.ResponsibleUser != nil || got.Description != "Aluguel de outubro" {
		t.Errorf("null deve limpar sem apagar o resto: %s", r.Body)
	}
	if r := a.do("PATCH", url, map[string]any{"amountCents": 0}, c); r.Code != 400 {
		t.Errorf("valor inválido: %d", r.Code)
	}

	// excluir (lógico) e desfazer
	if r := a.do("DELETE", url, nil, c); r.Code != 204 {
		t.Fatalf("excluir: %d", r.Code)
	}
	if r := a.do("GET", url, nil, c); r.Code != 404 {
		t.Errorf("excluída some: %d", r.Code)
	}
	if r := a.do("POST", url+"/restore", nil, c); r.Code != 200 {
		t.Errorf("restaurar: %d %s", r.Code, r.Body)
	}
	if r := a.do("POST", url+"/restore", nil, c); r.Code != 409 {
		t.Errorf("restaurar o que não está excluído: %d", r.Code)
	}
	// categoria excluída enquanto a invoice estava excluída: restaurar é 409
	a.do("DELETE", url, nil, c)
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	if r := a.do("DELETE", "/api/households/"+house+"/categories/"+catID, nil, c); r.Code != 204 {
		t.Fatalf("categoria sem invoices ativas pode ser excluída: %d", r.Code)
	}
	if r := a.do("POST", url+"/restore", nil, c); r.Code != 409 {
		t.Errorf("restaurar com categoria excluída: %d", r.Code)
	}
}

func TestPagarEDesfazer(t *testing.T) {
	a, c, house, catID := casa(t)
	i, _ := a.newInvoice(c, house, catID, nil)
	url := "/api/households/" + house + "/invoices/" + i.ID

	if r := a.do("POST", url+"/pay", map[string]any{"wallet": "ouro"}, c); r.Code != 400 {
		t.Errorf("carteira inválida: %d", r.Code)
	}
	if r := a.do("POST", url+"/pay", map[string]any{"wallet": "free", "amountCents": 0}, c); r.Code != 400 {
		t.Errorf("valor pago inválido: %d", r.Code)
	}

	// pagar com padrões: data = hoje, valor = o da invoice
	r := a.do("POST", url+"/pay", map[string]any{"wallet": "benefit"}, c)
	var res struct {
		Invoice  inv      `json:"invoice"`
		Warnings []string `json:"warnings"`
	}
	r.json(&res)
	p := res.Invoice.Paid
	if r.Code != 200 || res.Invoice.Status != "paid" || p == nil || p.Wallet != "benefit" || p.PaidAt != "2026-10-18" || p.AmountCents != 150000 || p.PaidBy == "" {
		t.Fatalf("pagar: %d %s", r.Code, r.Body)
	}
	// pagar de novo: 409 e nada muda
	if r := a.do("POST", url+"/pay", map[string]any{"wallet": "free"}, c); r.Code != 409 {
		t.Errorf("pagamento duplo: %d", r.Code)
	}
	var again inv
	a.do("GET", url, nil, c).json(&again)
	if again.Paid.Wallet != "benefit" {
		t.Error("o segundo pagamento não pode sobrescrever o primeiro")
	}

	// desfazer
	var un inv
	r = a.do("DELETE", url+"/pay", nil, c)
	r.json(&un)
	if r.Code != 200 || un.Status != "pending" || un.Paid != nil {
		t.Fatalf("desfazer: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", url+"/pay", nil, c); r.Code != 409 {
		t.Errorf("desfazer o que não está pago: %d", r.Code)
	}
	// pagar com juros e data passada
	r = a.do("POST", url+"/pay", map[string]any{"wallet": "free", "amountCents": 152345, "paidAt": "2026-10-15"}, c)
	res.Invoice = inv{}
	r.json(&res)
	if r.Code != 200 || res.Invoice.Paid.AmountCents != 152345 || res.Invoice.Paid.PaidAt != "2026-10-15" || res.Invoice.AmountCents != 150000 {
		t.Errorf("valor pago pode diferir do valor da invoice: %s", r.Body)
	}
	// invoice excluída não paga (404)
	a.do("DELETE", url+"/pay", nil, c)
	a.do("DELETE", url, nil, c)
	if r := a.do("POST", url+"/pay", map[string]any{"wallet": "free"}, c); r.Code != 404 {
		t.Errorf("pagar excluída: %d", r.Code)
	}
}

func TestListagemFiltrosEPaginacao(t *testing.T) {
	a, c, house, catID := casa(t)
	var cats []cat
	a.do("GET", "/api/households/"+house+"/categories", nil, c).json(&cats)
	mercado := cats[1].ID

	mk := func(desc, due string, extra map[string]any) inv {
		m := map[string]any{"description": desc, "dueDate": due}
		for k, v := range extra {
			m[k] = v
		}
		i, r := a.newInvoice(c, house, catID, m)
		if r.Code != 201 {
			t.Fatalf("%s: %d %s", desc, r.Code, r.Body)
		}
		return i
	}
	i1 := mk("Aluguel", "2026-10-05", nil)                                        // atrasada
	i2 := mk("Luz", "2026-10-25", nil)                                            // a vencer
	i3 := mk("Mercado 100%", "2026-10-12", map[string]any{"categoryId": mercado}) // atrasada, outra categoria
	i4 := mk("Internet", "2026-11-03", nil)                                       // novembro
	i5 := mk("Água", "2026-10-30", nil)                                           // a vencer
	a.do("POST", "/api/households/"+house+"/invoices/"+i2.ID+"/pay", map[string]any{"wallet": "free"}, c)
	_ = i4
	list := func(q string) (items []inv, next string, code int) {
		var page struct {
			Items      []inv  `json:"items"`
			NextCursor string `json:"nextCursor"`
		}
		r := a.do("GET", "/api/households/"+house+"/invoices"+q, nil, c)
		if r.Code == 200 {
			r.json(&page)
		}
		return page.Items, page.NextCursor, r.Code
	}
	names := func(items []inv) string {
		s := ""
		for _, i := range items {
			s += i.Description + ","
		}
		return s
	}

	// mês de competência, ordenado por vencimento
	if items, _, code := list("?month=2026-10-01"); code != 200 || names(items) != "Aluguel,Mercado 100%,Luz,Água," {
		t.Errorf("mês: %d %s", code, names(items))
	}
	if items, _, _ := list("?month=2026-11-01"); names(items) != "Internet," {
		t.Errorf("novembro: %s", names(items))
	}
	// status derivado
	if items, _, _ := list("?month=2026-10-01&status=overdue"); names(items) != "Aluguel,Mercado 100%," {
		t.Errorf("overdue: %s", names(items))
	}
	if items, _, _ := list("?month=2026-10-01&status=pending"); names(items) != "Água," {
		t.Errorf("pending: %s", names(items))
	}
	if items, _, _ := list("?month=2026-10-01&status=paid"); names(items) != "Luz," {
		t.Errorf("paid: %s", names(items))
	}
	// categoria, busca (case-insensitive, % tratado como texto)
	if items, _, _ := list("?categoryId=" + mercado); names(items) != "Mercado 100%," {
		t.Errorf("categoria: %s", names(items))
	}
	if items, _, _ := list("?q=aLUgu"); names(items) != "Aluguel," {
		t.Errorf("busca: %s", names(items))
	}
	if items, _, _ := list("?q=%25"); names(items) != "Mercado 100%," {
		t.Errorf("o %% da busca é literal, não curinga: %s", names(items))
	}

	// paginação por cursor: 2 por página, sem repetir nem pular
	var all []string
	cursor := ""
	for pages := 0; pages < 10; pages++ {
		q := "?limit=2"
		if cursor != "" {
			q += "&cursor=" + cursor
		}
		items, next, code := list(q)
		if code != 200 {
			t.Fatalf("página: %d", code)
		}
		for _, i := range items {
			all = append(all, i.ID)
		}
		if next == "" {
			break
		}
		cursor = next
	}
	want := []string{i1.ID, i3.ID, i2.ID, i5.ID, i4.ID}
	if fmt.Sprint(all) != fmt.Sprint(want) {
		t.Errorf("paginação: %v, quer %v", all, want)
	}

	// parâmetros inválidos
	for _, q := range []string{"?status=outro", "?month=2026-10-15", "?cursor=lixo", "?month=abc"} {
		if _, _, code := list(q); code != 400 {
			t.Errorf("%s deveria ser 400: %d", q, code)
		}
	}
	// excluídas não aparecem
	a.do("DELETE", "/api/households/"+house+"/invoices/"+i1.ID, nil, c)
	if items, _, _ := list("?month=2026-10-01"); names(items) != "Mercado 100%,Luz,Água," {
		t.Errorf("excluída na lista: %s", names(items))
	}
}

func TestInvoiceIsolamentoEPapeis(t *testing.T) {
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	cA, houseA := a.register("Ana", "ana@x.com", "Casa A")
	cB, houseB := a.register("Beto", "beto@x.com", "Casa B")
	var catsA, catsB []cat
	a.do("GET", "/api/households/"+houseA+"/categories", nil, cA).json(&catsA)
	a.do("GET", "/api/households/"+houseB+"/categories", nil, cB).json(&catsB)

	ia, _ := a.newInvoice(cA, houseA, catsA[0].ID, nil)
	// Beto não vê a casa da Ana (404 do porteiro) e, na própria casa, o id da Ana não existe
	if r := a.do("GET", "/api/households/"+houseA+"/invoices/"+ia.ID, nil, cB); r.Code != 404 {
		t.Errorf("casa alheia: %d", r.Code)
	}
	for _, m := range []string{"GET", "PATCH", "DELETE"} {
		var body any
		if m == "PATCH" {
			body = map[string]any{"description": "x"}
		}
		if r := a.do(m, "/api/households/"+houseB+"/invoices/"+ia.ID, body, cB); r.Code != 404 {
			t.Errorf("%s do id da Ana na casa do Beto: %d", m, r.Code)
		}
	}
	if r := a.do("POST", "/api/households/"+houseB+"/invoices/"+ia.ID+"/pay", map[string]any{"wallet": "free"}, cB); r.Code != 404 {
		t.Errorf("pagar invoice alheia: %d", r.Code)
	}
	var page struct{ Items []inv }
	a.do("GET", "/api/households/"+houseB+"/invoices", nil, cB).json(&page)
	if len(page.Items) != 0 {
		t.Errorf("lista do Beto vazou invoices da Ana: %+v", page.Items)
	}

	// viewer lê mas não escreve
	var betoID string
	a.db.Raw("SELECT id::text FROM users WHERE email='beto@x.com'").Scan(&betoID)
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", houseA, betoID)
	if r := a.do("GET", "/api/households/"+houseA+"/invoices", nil, cB); r.Code != 200 {
		t.Errorf("viewer lendo: %d", r.Code)
	}
	if r := a.do("GET", "/api/households/"+houseA+"/categories", nil, cB); r.Code != 200 {
		t.Errorf("viewer lendo categorias: %d", r.Code)
	}
	for name, req := range map[string]func() resp{
		"criar": func() resp { _, r := a.newInvoice(cB, houseA, catsA[0].ID, nil); return r },
		"pagar": func() resp {
			return a.do("POST", "/api/households/"+houseA+"/invoices/"+ia.ID+"/pay", map[string]any{"wallet": "free"}, cB)
		},
		"editar": func() resp {
			return a.do("PATCH", "/api/households/"+houseA+"/invoices/"+ia.ID, map[string]any{"description": "x"}, cB)
		},
		"excluir": func() resp { return a.do("DELETE", "/api/households/"+houseA+"/invoices/"+ia.ID, nil, cB) },
		"categoria": func() resp {
			return a.do("POST", "/api/households/"+houseA+"/categories", map[string]any{"name": "X"}, cB)
		},
	} {
		if r := req(); r.Code != 403 {
			t.Errorf("viewer %s deveria ser 403: %d", name, r.Code)
		}
	}
}
