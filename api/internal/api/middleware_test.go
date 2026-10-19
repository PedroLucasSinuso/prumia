package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"

	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

// probeRouter registra rotas de teste com o middleware real, para exercitar as regras de papel
// sem depender de operações de negócio que ainda não existem.
func probeRouter(a *app) *gin.Engine {
	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	mw := auth.Middleware(a.auth, a.hs, a.cookie, nil)
	guard := func(c *gin.Context) {
		mw(c)
	}
	for _, m := range []string{"GET", "POST"} {
		r.Handle(m, "/api/households/:householdId/probe", guard, ok)
	}
	r.DELETE("/api/households/:householdId/members/:userId", guard, ok)
	r.NoRoute(httpx.NotFound)
	return r
}

func (a *app) probe(r *gin.Engine, method, path string, c *http.Cookie) int {
	req := httptest.NewRequest(method, path, nil)
	req.AddCookie(c)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestViewerSoLeEMembroEscreve(t *testing.T) {
	a := newApp(t, opts{openRegistration: true})
	cAna, house := a.register("Ana", "ana@x.com", "Casa")
	cBeto, _ := a.register("Beto", "beto@x.com", "Outra")
	var betoID, anaID string
	a.db.Raw("SELECT id::text FROM users WHERE email='beto@x.com'").Scan(&betoID)
	a.db.Raw("SELECT id::text FROM users WHERE email='ana@x.com'").Scan(&anaID)
	r := probeRouter(a)
	base := "/api/households/" + house

	// Beto ainda não é da casa da Ana: 404
	if got := a.probe(r, "GET", base+"/probe", cBeto); got != 404 {
		t.Errorf("não-membro: %d", got)
	}

	// Beto entra como viewer
	a.db.Exec("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'viewer')", house, betoID)
	if got := a.probe(r, "GET", base+"/probe", cBeto); got != 200 {
		t.Errorf("viewer lendo: %d", got)
	}
	if got := a.probe(r, "POST", base+"/probe", cBeto); got != 403 {
		t.Errorf("viewer escrevendo deveria ser 403: %d", got)
	}
	// viewer pode sair da casa (DELETE em si mesmo), mas não remover outro
	if got := a.probe(r, "DELETE", base+"/members/"+betoID, cBeto); got != 200 {
		t.Errorf("viewer saindo da casa: %d", got)
	}
	if got := a.probe(r, "DELETE", base+"/members/"+anaID, cBeto); got != 403 {
		t.Errorf("viewer removendo outro: %d", got)
	}

	// Beto vira member: escreve
	a.db.Exec("UPDATE household_members SET role='member' WHERE household_id=? AND user_id=?", house, betoID)
	if got := a.probe(r, "POST", base+"/probe", cBeto); got != 200 {
		t.Errorf("member escrevendo: %d", got)
	}

	// quem saiu (left_at) perde o acesso de imediato
	a.db.Exec("UPDATE household_members SET left_at=now() WHERE household_id=? AND user_id=?", house, betoID)
	if got := a.probe(r, "GET", base+"/probe", cBeto); got != 404 {
		t.Errorf("ex-membro: %d", got)
	}
	if got := a.probe(r, "POST", base+"/probe", cAna); got != 200 {
		t.Errorf("admin escrevendo: %d", got)
	}
}

func TestCasaExcluidaSomeParaTodos(t *testing.T) {
	a := newApp(t, opts{})
	c, house := a.register("Ana", "ana@x.com", "Casa")
	a.db.Exec("UPDATE households SET deleted_at = now() WHERE id = ?", house)
	if r := a.do("GET", "/api/households/"+house, nil, c); r.Code != 404 {
		t.Errorf("casa excluída: %d", r.Code)
	}
	var me struct{ Households []any }
	a.do("GET", "/api/auth/me", nil, c).json(&me)
	if len(me.Households) != 0 {
		t.Errorf("casa excluída não deve aparecer em /me: %v", me.Households)
	}
}

// As rotas públicas do código têm de ser exatamente as operações `security: []` do contrato.
func TestRotasPublicasBatemComOContrato(t *testing.T) {
	raw, err := os.ReadFile("../../../openapi/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Paths map[string]map[string]yaml.Node `yaml:"paths"`
	}
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{}
	for path, ops := range spec.Paths {
		for method, node := range ops {
			if method == "parameters" { // lista de parâmetros comuns do caminho, não é uma operação
				continue
			}
			var op struct {
				Security *[]any `yaml:"security"`
			}
			if err := node.Decode(&op); err != nil {
				t.Fatalf("%s %s: %v", method, path, err)
			}
			if op.Security != nil && len(*op.Security) == 0 { // `security: []` explícito = pública
				ginPath := "/api" + path
				for _, seg := range strings.Split(path, "/") {
					if strings.HasPrefix(seg, "{") {
						ginPath = strings.ReplaceAll(ginPath, seg, ":"+strings.Trim(seg, "{}"))
					}
				}
				want[strings.ToUpper(method)+" "+ginPath] = true
			}
		}
	}
	for k := range want {
		if !auth.PublicRoutes[k] {
			t.Errorf("rota pública no contrato mas protegida no código: %s", k)
		}
	}
	for k := range auth.PublicRoutes {
		if !want[k] {
			t.Errorf("rota pública no código mas protegida no contrato: %s", k)
		}
	}
}
