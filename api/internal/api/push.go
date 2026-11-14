package api

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/auth"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/ratelimit"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/token"
	"github.com/PedroLucasSinuso/prumia/api/internal/push"
)

// Pushes implementa os avisos por Web Push do contrato. Não é recurso da casa: a assinatura é do usuário (e da sessão),
// por isso as rotas não levam {householdId} e exigem só estar logado.
type Pushes struct {
	Svc       *push.Service
	Log       *slog.Logger
	PublicKey string            // chave pública VAPID; vazia = desligado
	Cookie    auth.CookieConfig // para saber qual é a sessão atual (a assinatura fica presa a ela)
	testLimit *ratelimit.Limiter
}

func NewPushes(svc *push.Service, publicKey string, cookie auth.CookieConfig, log *slog.Logger) *Pushes {
	// Aviso de teste: 1 a cada 20 s por usuário, com folga de 3 (não vira um jeito de martelar o serviço de push).
	return &Pushes{Svc: svc, Log: log, PublicKey: publicKey, Cookie: cookie, testLimit: ratelimit.New(20*time.Second, 3)}
}

func pushDisabled(c *gin.Context) {
	httpx.WriteProblem(c, httpx.Problem{Status: http.StatusServiceUnavailable, Code: "push_disabled", Detail: "avisos desligados no servidor"})
}

// GetPushConfig: GET /push/config
func (h *Pushes) GetPushConfig(c *gin.Context) {
	out := gen.PushConfig{Enabled: h.Svc.Enabled()}
	if out.Enabled {
		out.PublicKey = &h.PublicKey
	}
	c.JSON(http.StatusOK, out)
}

// SavePushSubscription: PUT /push/subscriptions
func (h *Pushes) SavePushSubscription(c *gin.Context) {
	var body gen.PushSubscriptionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	err := h.Svc.Subscribe(c.Request.Context(), auth.CurrentUser(c).ID, token.Hash(h.Cookie.Token(c)),
		push.Subscription{Endpoint: body.Endpoint, P256dh: body.Keys.P256dh, Auth: body.Keys.Auth})
	if errors.Is(err, push.ErrDisabled) {
		pushDisabled(c)
		return
	}
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// DeletePushSubscription: POST /push/unsubscribe
func (h *Pushes) DeletePushSubscription(c *gin.Context) {
	var body gen.PushUnsubscribeInput
	if err := c.ShouldBindJSON(&body); err != nil {
		badJSON(c)
		return
	}
	if err := h.Svc.Unsubscribe(c.Request.Context(), auth.CurrentUser(c).ID, body.Endpoint); err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// SendPushTest: POST /push/test
func (h *Pushes) SendPushTest(c *gin.Context) {
	user := auth.CurrentUser(c)
	if !h.testLimit.Allow(user.ID.String()) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusTooManyRequests, Code: "too_many_requests"})
		return
	}
	sent, err := h.Svc.SendTest(c.Request.Context(), user.ID)
	if errors.Is(err, push.ErrDisabled) {
		pushDisabled(c)
		return
	}
	if err != nil {
		writeDomainError(c, h.Log, err)
		return
	}
	c.JSON(http.StatusOK, gen.PushTestResult{Sent: sent})
}
