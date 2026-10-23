package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/api/gen"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/httpx"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// "Minha conta" (Ajustes): editar nome e tema, trocar a senha e sair dos outros aparelhos.
// Tudo age só sobre o PRÓPRIO usuário da sessão: o id nunca vem do corpo nem da URL.

// Themes são os temas de cor aceitos (o CHECK da migration 00005 repete a lista).
var Themes = map[string]bool{"sistema": true, "marfim": true, "grafite": true, "contraste": true}

// AccountPatch: ponteiro nil = campo ausente (não mexe). Em PHP seria o "isset($body['name'])".
type AccountPatch struct {
	Name  *string
	Theme *string
}

// UpdateAccount muda nome e/ou tema do usuário e devolve o usuário atualizado.
func (s *Service) UpdateAccount(ctx context.Context, userID uuid.UUID, p AccountPatch) (User, error) {
	var v validation.Collector
	updates := map[string]any{}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if n := len([]rune(name)); n < 1 || n > 80 {
			v.Add("name", "informe um nome de 1 a 80 caracteres")
		}
		updates["name"] = name
	}
	if p.Theme != nil {
		if !Themes[*p.Theme] {
			v.Add("theme", "use sistema, marfim, grafite ou contraste")
		}
		updates["theme"] = *p.Theme
	}
	if err := v.Err(); err != nil {
		return User{}, err
	}
	db := s.db.WithContext(ctx)
	if len(updates) > 0 {
		// map[string]any (e não a struct): o GORM ignora campos "zerados" de struct em Updates (ver CLAUDE.md).
		updates["updated_at"] = s.cfg.Now()
		if err := db.Model(&User{}).Where("id = ?", userID).Updates(updates).Error; err != nil {
			return User{}, fmt.Errorf("atualizando conta: %w", err)
		}
	}
	var user User
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		return User{}, fmt.Errorf("relendo conta: %w", err)
	}
	return user, nil
}

// ChangePassword confere a senha atual, grava a nova (argon2id, como no cadastro) e encerra as OUTRAS sessões do
// usuário: quem tinha a senha antiga (ou uma sessão roubada) sai; este aparelho continua logado.
// currentToken é o token do cookie desta requisição (só o hash dele é comparado).
func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, currentToken, currentPassword, newPassword string) error {
	if n := len([]rune(newPassword)); n < MinPasswordLen || n > MaxPasswordLen {
		return validation.New("newPassword", fmt.Sprintf("a senha deve ter de %d a %d caracteres", MinPasswordLen, MaxPasswordLen))
	}
	var user User
	if err := s.db.WithContext(ctx).First(&user, "id = ?", userID).Error; err != nil {
		return fmt.Errorf("lendo usuário: %w", err)
	}
	if !VerifyPassword(currentPassword, user.PasswordHash) {
		return validation.New("currentPassword", "a senha atual não confere")
	}
	if currentPassword == newPassword {
		return validation.New("newPassword", "a nova senha precisa ser diferente da atual")
	}
	hash, err := HashPassword(newPassword) // caro: fora da transação
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&User{}).Where("id = ?", userID).
			Updates(map[string]any{"password_hash": hash, "updated_at": s.cfg.Now()}).Error; err != nil {
			return fmt.Errorf("gravando senha: %w", err)
		}
		if _, err := endOtherSessions(tx, userID, currentToken); err != nil {
			return err
		}
		// um link de redefinição pendente (gerado por admin) perde o sentido: a pessoa acabou de escolher a senha
		return tx.Where("user_id = ? AND used_at IS NULL", userID).Delete(&PasswordResetToken{}).Error
	})
}

// EndOtherSessions encerra todas as sessões do usuário, menos a desta requisição. Devolve quantas encerrou.
func (s *Service) EndOtherSessions(ctx context.Context, userID uuid.UUID, currentToken string) (int64, error) {
	return endOtherSessions(s.db.WithContext(ctx), userID, currentToken)
}

func endOtherSessions(tx *gorm.DB, userID uuid.UUID, currentToken string) (int64, error) {
	if currentToken == "" {
		return 0, ErrUnauthenticated // sem o token atual, "as outras" seriam todas
	}
	res := tx.Where("user_id = ? AND token_hash <> ?", userID, HashToken(currentToken)).Delete(&Session{})
	if res.Error != nil {
		return 0, fmt.Errorf("encerrando sessões: %w", res.Error)
	}
	return res.RowsAffected, nil
}

// UpdateMe: PATCH /auth/me { name?, theme? }.
func (h *Handler) UpdateMe(c *gin.Context) {
	var body gen.MePatch
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	p := AccountPatch{Name: body.Name}
	if body.Theme != nil {
		t := string(*body.Theme)
		p.Theme = &t
	}
	user, err := h.svc.UpdateAccount(c.Request.Context(), CurrentUser(c).ID, p)
	if err != nil {
		h.writeError(c, err)
		return
	}
	h.respondMe(c, http.StatusOK, user)
}

// ChangePassword: POST /auth/password. Nunca loga as senhas (nem em erro).
func (h *Handler) ChangePassword(c *gin.Context) {
	user := CurrentUser(c)
	if !h.passwordIP.Allow(c.ClientIP()) || !h.passwordUser.Allow(user.ID.String()) {
		tooMany(c)
		return
	}
	var body gen.ChangePasswordJSONRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusBadRequest, Code: "bad_request", Detail: "corpo JSON inválido"})
		return
	}
	if err := h.svc.ChangePassword(c.Request.Context(), user.ID, h.cookie.Token(c), body.CurrentPassword, body.NewPassword); err != nil {
		h.writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// EndOtherSessions: DELETE /auth/sessions/others.
func (h *Handler) EndOtherSessions(c *gin.Context) {
	n, err := h.svc.EndOtherSessions(c.Request.Context(), CurrentUser(c).ID, h.cookie.Token(c))
	if errors.Is(err, ErrUnauthenticated) {
		httpx.WriteProblem(c, httpx.Problem{Status: http.StatusUnauthorized, Code: "unauthenticated"})
		return
	}
	if err != nil {
		h.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ended": n})
}
