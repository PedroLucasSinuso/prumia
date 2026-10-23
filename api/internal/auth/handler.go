package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/ratelimit"
)

// Handler implementa as operações de autenticação do contrato (Register, Login, Logout, GetMe).
type Handler struct {
	svc    *Service
	cookie CookieConfig
	log    *slog.Logger

	// Limites contra força bruta: por IP e por e-mail (o do e-mail impede varrer uma conta de vários IPs).
	loginIP, loginEmail, registerIP, resetIP *ratelimit.Limiter
	// Troca de senha: limite por usuário (quem roubou a sessão não pode testar senhas à vontade) e por IP.
	passwordUser, passwordIP *ratelimit.Limiter
}

func NewHandler(svc *Service, cookie CookieConfig, log *slog.Logger) *Handler {
	return &Handler{
		svc: svc, cookie: cookie, log: log,
		loginIP:    ratelimit.New(6*time.Second, 10), // 10 tentativas seguidas, depois 10/min
		loginEmail: ratelimit.New(12*time.Second, 5), // 5 seguidas, depois 5/min
		registerIP: ratelimit.New(12*time.Second, 5),
		resetIP:    ratelimit.New(12*time.Second, 5),
		// mesmos limites do login
		passwordUser: ratelimit.New(12*time.Second, 5),
		passwordIP:   ratelimit.New(6*time.Second, 10),
	}
}

func meta(c *gin.Context) Meta { return Meta{UserAgent: c.Request.UserAgent(), IP: c.ClientIP()} }

func tooMany(c *gin.Context) {
	c.Header("Retry-After", "60")
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests", Detail: "muitas tentativas; aguarde um minuto"})
}

// writeError converte erros do serviço em respostas HTTP. É o ÚNICO lugar que faz esse mapeamento.
func (h *Handler) writeError(c *gin.Context, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "validation_error", Fields: ve.Fields})
	case errors.Is(err, ErrInvalidCredentials):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnauthorized, Code: "invalid_credentials", Detail: err.Error()})
	case errors.Is(err, ErrEmailTaken):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusConflict, Code: "email_taken", Detail: err.Error()})
	case errors.Is(err, ErrRegistrationClosed):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "registration_closed", Detail: err.Error()})
	case errors.Is(err, household.ErrInviteInvalid):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "invalid_invite", Detail: err.Error()})
	case errors.Is(err, ErrInvalidResetToken):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "invalid_reset_token", Detail: err.Error()})
	case errors.Is(err, ErrResetNotAllowed):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "reset_not_allowed", Detail: err.Error()})
	case errors.Is(err, household.ErrForbidden):
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusForbidden, Code: "forbidden", Detail: err.Error()})
	case errors.Is(err, household.ErrNotFound):
		httpx.NotFound(c)
	default:
		h.log.Error("erro inesperado", "erro", err, "rota", c.FullPath())
		httpx.Internal(c)
	}
}

func (h *Handler) me(c *gin.Context, user User) (gen.Me, error) {
	refs, err := h.svc.Households(c.Request.Context(), user.ID)
	if err != nil {
		return gen.Me{}, err
	}
	out := gen.Me{Id: user.ID, Name: user.Name, Email: user.Email, Theme: gen.Theme(user.Theme), Households: make([]gen.HouseholdRef, len(refs))}
	for i, r := range refs {
		out.Households[i] = gen.HouseholdRef{Id: r.ID, Name: r.Name, Role: gen.Role(r.Role)}
	}
	return out, nil
}

func (h *Handler) Register(c *gin.Context) {
	if !h.registerIP.Allow(c.ClientIP()) {
		tooMany(c)
		return
	}
	var body gen.RegisterRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	in := RegisterInput{Name: body.Name, Email: body.Email, Password: body.Password}
	if body.HouseholdName != nil {
		in.HouseholdName = *body.HouseholdName
	}
	if body.InviteToken != nil {
		in.InviteToken = *body.InviteToken
	}
	user, token, err := h.svc.Register(c.Request.Context(), in, meta(c))
	if err != nil {
		h.writeError(c, err)
		return
	}
	h.cookie.Set(c, token)
	h.respondMe(c, http.StatusCreated, user)
}

func (h *Handler) Login(c *gin.Context) {
	var body gen.LoginRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	// A chave do limite por e-mail é o e-mail NORMALIZADO, igual ao que o serviço usa na busca: senão "Ana@x.com",
	// "ANA@x.com" e " ana@x.com" seriam baldes diferentes para a mesma conta.
	emailKey := strings.ToLower(strings.TrimSpace(string(body.Email)))
	if !h.loginIP.Allow(c.ClientIP()) || !h.loginEmail.Allow(emailKey) {
		tooMany(c)
		return
	}
	user, token, err := h.svc.Login(c.Request.Context(), string(body.Email), body.Password, meta(c))
	if err != nil {
		h.writeError(c, err)
		return
	}
	// A sessão que este navegador já tinha (de outra pessoa, ou antiga) é encerrada: o cookie vai ser trocado e
	// a sessão anterior não deve continuar viva no banco.
	if old := h.cookie.Token(c); old != "" {
		if err := h.svc.Logout(c.Request.Context(), old); err != nil {
			h.log.Error("encerrando sessão anterior", "erro", err)
		}
	}
	h.cookie.Set(c, token)
	h.respondMe(c, http.StatusOK, user)
}

func (h *Handler) Logout(c *gin.Context) {
	if err := h.svc.Logout(c.Request.Context(), h.cookie.Token(c)); err != nil {
		h.writeError(c, err)
		return
	}
	h.cookie.Clear(c)
	c.Status(http.StatusNoContent)
}

func (h *Handler) GetMe(c *gin.Context) {
	h.respondMe(c, http.StatusOK, CurrentUser(c))
}

func (h *Handler) respondMe(c *gin.Context, status int, user User) {
	me, err := h.me(c, user)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(status, me)
}

// CreatePasswordResetLink: POST /households/{householdId}/members/{userId}/password-reset-link.
// Só admin; e só se o solicitante administra TODAS as casas ativas do alvo (regra no serviço).
func (h *Handler) CreatePasswordResetLink(c *gin.Context, householdId gen.HouseholdId, userId gen.UserId) {
	if !RequireAdmin(c) {
		return
	}
	tok, expires, err := h.svc.CreateResetLink(c.Request.Context(), householdId, CurrentUser(c).ID, userId)
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"token": tok, "expiresAt": expires})
}

// ResetPassword: POST /auth/password-reset (pública). Troca a senha e encerra todas as sessões do usuário.
func (h *Handler) ResetPassword(c *gin.Context) {
	if !h.resetIP.Allow(c.ClientIP()) {
		tooMany(c)
		return
	}
	var body gen.ResetPasswordJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	if err := h.svc.ResetPassword(c.Request.Context(), body.Token, body.NewPassword); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
