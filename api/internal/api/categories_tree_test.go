package api

import (
	"net/http"
	"testing"
)

type catOut struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ParentID   *string `json:"parentId"`
	SortOrder  int     `json:"sortOrder"`
	Archived   bool    `json:"archived"`
	IsEssentia bool    `json:"isEssential"`
}

func (a *app) newCat(c *http.Cookie, house string, body map[string]any) (catOut, resp) {
	a.t.Helper()
	r := a.do("POST", "/api/households/"+house+"/categories", body, c)
	var out catOut
	if r.Code == http.StatusCreated {
		r.json(&out)
	}
	return out, r
}

func (a *app) cats(c *http.Cookie, house string) map[string]catOut {
	a.t.Helper()
	var list []catOut
	a.do("GET", "/api/households/"+house+"/categories?includeArchived=true", nil, c).json(&list)
	out := map[string]catOut{}
	for _, x := range list {
		out[x.ID] = x
	}
	return out
}

func TestSubcategoriaCriarEOrdenarNoGrupo(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	moradia, r := a.newCat(c, house, map[string]any{"name": "Habitação"})
	if r.Code != 201 {
		t.Fatalf("mãe: %d %s", r.Code, r.Body)
	}
	gas, r := a.newCat(c, house, map[string]any{"name": "Gás", "parentId": moradia.ID})
	if r.Code != 201 || gas.ParentID == nil || *gas.ParentID != moradia.ID || gas.SortOrder != 0 {
		t.Fatalf("filha: %d %s", r.Code, r.Body)
	}
	luz, _ := a.newCat(c, house, map[string]any{"name": "Luz", "parentId": moradia.ID})
	if luz.SortOrder != 1 { // ordem entre as irmãs, não entre todas as categorias da casa
		t.Errorf("sortOrder da 2ª filha = %d", luz.SortOrder)
	}

	// nome único por mãe: "Outros" em duas mães vale; repetido dentro da mesma mãe, não; e no topo continua único
	outros := map[string]any{"name": "Outros"}
	outros["parentId"] = moradia.ID
	if _, r := a.newCat(c, house, outros); r.Code != 201 {
		t.Fatalf("Outros na 1ª mãe: %d %s", r.Code, r.Body)
	}
	if _, r := a.newCat(c, house, outros); r.Code != 409 {
		t.Errorf("Outros repetido na mesma mãe: %d", r.Code)
	}
	transporte, _ := a.newCat(c, house, map[string]any{"name": "Locomoção"})
	if _, r := a.newCat(c, house, map[string]any{"name": "Outros", "parentId": transporte.ID}); r.Code != 201 {
		t.Errorf("Outros em outra mãe: %d %s", r.Code, r.Body)
	}
	if _, r := a.newCat(c, house, map[string]any{"name": "habitação"}); r.Code != 409 {
		t.Errorf("nome repetido no topo: %d", r.Code)
	}
}

func TestSubcategoriaRegrasDosDoisNiveis(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	base := "/api/households/" + house + "/categories/"
	mae, _ := a.newCat(c, house, map[string]any{"name": "Mãe"})
	filha, _ := a.newCat(c, house, map[string]any{"name": "Filha", "parentId": mae.ID})
	solta, _ := a.newCat(c, house, map[string]any{"name": "Solta"})

	// neta: recusada
	_, r := a.newCat(c, house, map[string]any{"name": "Neta", "parentId": filha.ID})
	assertField(t, r, 400, "parentId")
	// mãe com filhas não vira filha de outra
	assertField(t, a.do("PATCH", base+mae.ID, map[string]any{"parentId": solta.ID}, c), 400, "parentId")
	// dentro dela mesma
	assertField(t, a.do("PATCH", base+solta.ID, map[string]any{"parentId": solta.ID}, c), 400, "parentId")
	// mãe inexistente
	_, r = a.newCat(c, house, map[string]any{"name": "X", "parentId": "00000000-0000-4000-8000-000000000000"})
	assertField(t, r, 400, "parentId")

	// mover a solta para dentro da mãe e voltar ao topo (null)
	r = a.do("PATCH", base+solta.ID, map[string]any{"parentId": mae.ID}, c)
	var moved catOut
	r.json(&moved)
	if r.Code != 200 || moved.ParentID == nil || *moved.ParentID != mae.ID || moved.SortOrder != 1 {
		t.Fatalf("mover: %d %s", r.Code, r.Body)
	}
	r = a.do("PATCH", base+solta.ID, map[string]any{"parentId": nil}, c)
	var back catOut // struct nova: o JSON omite parentId quando é null e não "zera" o valor antigo
	r.json(&back)
	if r.Code != 200 || back.ParentID != nil {
		t.Fatalf("voltar ao topo: %d %s", r.Code, r.Body)
	}
}

func TestSubcategoriaDeOutraCasaEhRecusada(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	ana, houseA := a.register("Ana", "ana@x.com", "Casa A")
	beto, houseB := a.register("Beto", "beto@x.com", "Casa B")
	daAna, _ := a.newCat(ana, houseA, map[string]any{"name": "Só da A"})
	_, r := a.newCat(beto, houseB, map[string]any{"name": "Filha", "parentId": daAna.ID})
	assertField(t, r, 400, "parentId")
}

func TestArquivarMaeEscondeFilhasERestauraSoAsDoLote(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	base := "/api/households/" + house + "/categories/"
	mae, _ := a.newCat(c, house, map[string]any{"name": "Mãe"})
	f1, _ := a.newCat(c, house, map[string]any{"name": "F1", "parentId": mae.ID})
	f2, _ := a.newCat(c, house, map[string]any{"name": "F2", "parentId": mae.ID})
	// F2 foi arquivada antes, à parte
	a.do("PATCH", base+f2.ID, map[string]any{"archived": true}, c)

	if r := a.do("PATCH", base+mae.ID, map[string]any{"archived": true}, c); r.Code != 200 {
		t.Fatalf("arquivar mãe: %d %s", r.Code, r.Body)
	}
	got := a.cats(c, house)
	if !got[mae.ID].Archived || !got[f1.ID].Archived || !got[f2.ID].Archived {
		t.Fatalf("depois de arquivar a mãe: %+v", got)
	}
	// restaurar uma filha com a mãe arquivada: recusado, com orientação
	assertField(t, a.do("PATCH", base+f1.ID, map[string]any{"archived": false}, c), 400, "archived")

	if r := a.do("PATCH", base+mae.ID, map[string]any{"archived": false}, c); r.Code != 200 {
		t.Fatalf("restaurar mãe: %d %s", r.Code, r.Body)
	}
	got = a.cats(c, house)
	if got[mae.ID].Archived || got[f1.ID].Archived {
		t.Errorf("mãe e F1 deveriam voltar: %+v", got)
	}
	if !got[f2.ID].Archived {
		t.Errorf("F2 foi arquivada à parte e deveria continuar arquivada")
	}
	// criar filha dentro de mãe arquivada: recusado
	a.do("PATCH", base+mae.ID, map[string]any{"archived": true}, c)
	_, r := a.newCat(c, house, map[string]any{"name": "F3", "parentId": mae.ID})
	assertField(t, r, 400, "parentId")
}

func TestExcluirMaeComFilhasEhRecusado(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	base := "/api/households/" + house + "/categories/"
	mae, _ := a.newCat(c, house, map[string]any{"name": "Mãe"})
	filha, _ := a.newCat(c, house, map[string]any{"name": "Filha", "parentId": mae.ID})
	assertCode(t, a.do("DELETE", base+mae.ID, nil, c), 409, "category_has_children")
	if r := a.do("DELETE", base+filha.ID, nil, c); r.Code != http.StatusNoContent {
		t.Fatalf("excluir filha sem uso: %d %s", r.Code, r.Body)
	}
	if r := a.do("DELETE", base+mae.ID, nil, c); r.Code != http.StatusNoContent {
		t.Fatalf("excluir mãe sem filhas: %d %s", r.Code, r.Body)
	}
}

// A conta fica ligada à categoria mais específica; filha arquivada (junto da mãe) não aceita conta nova.
func TestContaEmSubcategoria(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	mae, _ := a.newCat(c, house, map[string]any{"name": "Mãe"})
	filha, _ := a.newCat(c, house, map[string]any{"name": "Filha", "parentId": mae.ID})
	for _, id := range []string{mae.ID, filha.ID} {
		if _, r := a.newInvoice(c, house, id, nil); r.Code != 201 {
			t.Fatalf("conta na categoria %s: %d %s", id, r.Code, r.Body)
		}
	}
	// com contas, nem mãe nem filha podem ser excluídas (só arquivadas)
	assertCode(t, a.do("DELETE", "/api/households/"+house+"/categories/"+filha.ID, nil, c), 409, "category_in_use")
	a.do("PATCH", "/api/households/"+house+"/categories/"+mae.ID, map[string]any{"archived": true}, c)
	_, r := a.newInvoice(c, house, filha.ID, nil)
	assertField(t, r, 400, "categoryId")
}
