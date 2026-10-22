package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
)

const (
	ctxUser = "auth.user"
	ctxRole = "auth.role"
)

// PublicRoutes são as únicas rotas acessíveis sem login ("MÉTODO caminho-do-gin"). Deve coincidir com as
// operações `security: []` do openapi.yaml; um teste confere isso, para o contrato e o código não divergirem.
var PublicRoutes = map[string]bool{
	"GET /api/healthz":              true,
	"POST /api/auth/register":       true,
	"POST /api/auth/login":          true,
	"POST /api/auth/password-reset": true,
}

// CookieConfig descreve o cookie de sessão.
type CookieConfig struct {
	Name   string
	Secure bool // true em produção (HTTPS); o navegador só envia o cookie por HTTPS
	MaxAge time.Duration
}

// Set grava o cookie: httpOnly (JavaScript não lê, protege contra XSS) e SameSite=Lax (não vai em POST
// de outros sites, protege contra CSRF).
func (cc CookieConfig) Set(c *gin.Context, token string) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cc.Name, Value: token, Path: "/", MaxAge: int(cc.MaxAge.Seconds()),
		HttpOnly: true, Secure: cc.Secure, SameSite: http.SameSiteLaxMode,
	})
}

func (cc CookieConfig) Clear(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cc.Name, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: cc.Secure, SameSite: http.SameSiteLaxMode,
	})
}

func (cc CookieConfig) Token(c *gin.Context) string {
	v, err := c.Cookie(cc.Name)
	if err != nil {
		return ""
	}
	return v
}

// CurrentUser devolve o usuário autenticado desta requisição (preenchido pelo middleware).
func CurrentUser(c *gin.Context) User {
	u, _ := c.Get(ctxUser)
	user, _ := u.(User)
	return user
}

// CurrentRole devolve o papel do usuário na casa da rota (vazio se a rota não tem {householdId}).
func CurrentRole(c *gin.Context) household.Role {
	r, _ := c.Get(ctxRole)
	role, _ := r.(household.Role)
	return role
}

// RequireAdmin responde 403 e devolve false se o usuário não for admin da casa. Use no início de handlers admin.
func RequireAdmin(c *gin.Context) bool {
	if CurrentRole(c) != household.RoleAdmin {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "forbidden", Detail: "apenas administradores da casa"})
		return false
	}
	return true
}

func isWrite(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

// sameOrigin: se o navegador informou Origin (sempre informa em POST/PATCH/DELETE cross-site), ele tem de ser o
// próprio host. Defesa em profundidade além do SameSite do cookie. Clientes sem Origin (Postman, curl) passam.
func sameOrigin(c *gin.Context) bool {
	origin := c.GetHeader("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host == c.Request.Host
}

// Middleware é o porteiro de todas as rotas do contrato:
//  1. rejeita escrita vinda de outra origem (CSRF);
//  2. exige sessão válida, exceto nas PublicRoutes;
//  3. em rotas com {householdId}: exige ser membro ativo (senão 404, sem revelar que a casa existe)
//     e bloqueia escrita de `viewer`.
func Middleware(svc *Service, hs *household.Service, ck CookieConfig, log *slog.Logger) func(*gin.Context) {
	return func(c *gin.Context) {
		if isWrite(c.Request.Method) && !sameOrigin(c) {
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "bad_origin"})
			return
		}
		if PublicRoutes[c.Request.Method+" "+c.FullPath()] {
			return
		}

		user, err := svc.Authenticate(c.Request.Context(), ck.Token(c))
		if err != nil {
			if !errors.Is(err, ErrUnauthenticated) {
				log.Error("autenticando", "erro", err)
				httpx.Internal(c)
				return
			}
			if ck.Token(c) != "" {
				ck.Clear(c) // sessão vencida/inválida: apaga o cookie para o navegador não reenviá-lo
			}
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnauthorized, Code: "unauthenticated"})
			return
		}
		c.Set(ctxUser, user)

		raw := c.Param("householdId")
		if raw == "" {
			return
		}
		hid, err := uuid.Parse(raw) // o código gerado já validou, mas não custa nada
		if err != nil {
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request"})
			return
		}
		role, err := hs.Membership(c.Request.Context(), hid, user.ID)
		if errors.Is(err, household.ErrNotFound) {
			httpx.NotFound(c)
			return
		}
		if err != nil {
			log.Error("verificando membro", "erro", err)
			httpx.Internal(c)
			return
		}
		c.Set(ctxRole, role)

		// viewer só lê. Exceção: sair da casa (DELETE no próprio membro).
		leavingSelf := c.Request.Method == http.MethodDelete && c.Param("userId") == user.ID.String()
		if isWrite(c.Request.Method) && !role.CanWrite() && !leavingSelf {
			httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "read_only", Detail: "seu papel nesta casa é somente leitura"})
			return
		}
	}
}
