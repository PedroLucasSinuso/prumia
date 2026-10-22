package auth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/household"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// Erros de negócio. Em Go, erros são valores: quem chama compara com errors.Is e decide a resposta HTTP.
var (
	ErrInvalidCredentials = errors.New("e-mail ou senha inválidos")
	ErrEmailTaken         = errors.New("e-mail já cadastrado")
	ErrRegistrationClosed = errors.New("cadastro livre desativado: peça um convite a um administrador")
	ErrUnauthenticated    = errors.New("não autenticado")
)

// ValidationError é o erro de validação por campo compartilhado (vira `fields` no problem+json).
type ValidationError = validation.Error

// DefaultSessionMaxAge é a validade absoluta padrão da sessão (SESSION_MAX_AGE_DAYS=90).
const DefaultSessionMaxAge = 90 * 24 * time.Hour

type Config struct {
	SessionTTL       time.Duration // validade da sessão (renovada com o uso)
	SessionMaxAge    time.Duration // validade ABSOLUTA: a sessão morre este tempo após o login, mesmo em uso (padrão 90 dias)
	OpenRegistration bool          // permite cadastro sem convite mesmo já havendo usuários
	ResetTTL         time.Duration // validade do link de redefinição de senha (padrão 1h)
	Now              func() time.Time
}

type Service struct {
	db         *gorm.DB
	households *household.Service
	cfg        Config
	dummyHash  string // usado quando o e-mail não existe, para o login levar o mesmo tempo
}

func NewService(db *gorm.DB, households *household.Service, cfg Config) (*Service, error) {
	if cfg.SessionTTL == 0 {
		cfg.SessionTTL = 30 * 24 * time.Hour
	}
	if cfg.SessionMaxAge == 0 {
		cfg.SessionMaxAge = DefaultSessionMaxAge
	}
	if cfg.ResetTTL == 0 {
		cfg.ResetTTL = defaultResetTTL
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	dummy, err := HashPassword("senha-descartavel-para-igualar-tempo")
	if err != nil {
		return nil, err
	}
	return &Service{db: db, households: households, cfg: cfg, dummyHash: dummy}, nil
}

// Meta são dados da requisição guardados na sessão (úteis para o usuário revisar onde está logado).
type Meta struct{ UserAgent, IP string }

type RegisterInput struct {
	Name, Email, Password string
	HouseholdName         string
	InviteToken           string
}

// NormalizeEmail limpa e valida o e-mail. Guardamos em minúsculas; o índice único do banco também ignora caixa.
func NormalizeEmail(email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > 254 {
		return "", errors.New("e-mail inválido")
	}
	return email, nil
}

func validateRegister(in RegisterInput) (RegisterInput, error) {
	fields := map[string]string{}
	in.Name = strings.TrimSpace(in.Name)
	if n := len([]rune(in.Name)); n < 1 || n > 80 {
		fields["name"] = "informe um nome de 1 a 80 caracteres"
	}
	email, err := NormalizeEmail(in.Email)
	if err != nil {
		fields["email"] = err.Error()
	}
	in.Email = email
	if n := len([]rune(in.Password)); n < MinPasswordLen || n > MaxPasswordLen {
		fields["password"] = fmt.Sprintf("a senha deve ter de %d a %d caracteres", MinPasswordLen, MaxPasswordLen)
	}
	in.HouseholdName = strings.TrimSpace(in.HouseholdName)
	if in.HouseholdName == "" {
		in.HouseholdName = "Minha casa"
	}
	// Com convite o nome da casa é ignorado (o usuário entra na casa do convite), então não o validamos.
	if _, err := household.NormalizeName(in.HouseholdName); err != nil && in.InviteToken == "" {
		fields["householdName"] = err.Error()
	}
	if len(fields) > 0 {
		return in, &ValidationError{Fields: fields}
	}
	return in, nil
}

// Register cria o usuário. Sem convite, cria também uma casa nova (o usuário é admin). Tudo numa transação.
// O cadastro sem convite só é aceito para o PRIMEIRO usuário do sistema, salvo OpenRegistration.
// Com convite, NÃO cria casa: o usuário entra na casa do convite (com o papel dele) e o convite é consumido na
// mesma transação; se qualquer passo falhar (e-mail repetido, convite inválido), nada é gravado.
func (s *Service) Register(ctx context.Context, in RegisterInput, meta Meta) (User, string, error) {
	in, err := validateRegister(in)
	if err != nil {
		return User{}, "", err
	}
	hash, err := HashPassword(in.Password) // caro: feito fora da transação para não segurar a conexão
	if err != nil {
		return User{}, "", err
	}

	var user User
	var token string
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if in.InviteToken == "" {
			// Trava de aplicação (liberada ao fim da transação): impede dois "primeiros usuários" simultâneos.
			if err := tx.Exec("SELECT pg_advisory_xact_lock(7101)").Error; err != nil {
				return err
			}
			var users int64
			if err := tx.Model(&User{}).Count(&users).Error; err != nil {
				return err
			}
			if users > 0 && !s.cfg.OpenRegistration {
				return ErrRegistrationClosed
			}
		}

		user = User{Email: in.Email, Name: in.Name, PasswordHash: hash}
		if err := tx.Create(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				return ErrEmailTaken
			}
			return fmt.Errorf("criando usuário: %w", err)
		}
		if in.InviteToken != "" {
			if _, err := s.households.AcceptWithin(tx, in.InviteToken, user.ID); err != nil {
				return err
			}
		} else if _, err := s.households.CreateWithin(tx, in.HouseholdName, user.ID); err != nil {
			return err
		}
		token, err = s.createSession(tx, user.ID, meta)
		return err
	})
	return user, token, err
}

// Login valida as credenciais e abre uma sessão. Não revela se o e-mail existe: e-mail desconhecido e
// senha errada dão o mesmo erro e levam o mesmo tempo (verificamos contra um hash descartável).
func (s *Service) Login(ctx context.Context, email, password string, meta Meta) (User, string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var user User
	err := s.db.WithContext(ctx).Where("lower(email) = ?", email).First(&user).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		VerifyPassword(password, s.dummyHash)
		return User{}, "", ErrInvalidCredentials
	case err != nil:
		return User{}, "", err
	}
	if !VerifyPassword(password, user.PasswordHash) {
		return User{}, "", ErrInvalidCredentials
	}
	token, err := s.createSession(s.db.WithContext(ctx), user.ID, meta)
	if err != nil {
		return User{}, "", err
	}
	// Limpeza oportunista de sessões vencidas (barato, e dispensa um job agendado).
	s.db.WithContext(ctx).Where("expires_at < ?", s.cfg.Now()).Delete(&Session{})
	return user, token, nil
}

func (s *Service) createSession(tx *gorm.DB, userID uuid.UUID, meta Meta) (string, error) {
	token, hash, err := NewToken()
	if err != nil {
		return "", err
	}
	now := s.cfg.Now()
	sess := Session{
		TokenHash: hash, UserID: userID, CreatedAt: now, LastSeenAt: now,
		ExpiresAt: s.expiry(now, now),
		UserAgent: truncPtr(meta.UserAgent, 300), IP: truncPtr(meta.IP, 64),
	}
	if err := tx.Create(&sess).Error; err != nil {
		return "", fmt.Errorf("criando sessão: %w", err)
	}
	return token, nil
}

// expiry calcula o novo expires_at: SessionTTL a partir de agora (renovação deslizante), mas nunca além
// da validade absoluta contada da criação da sessão.
func (s *Service) expiry(createdAt, now time.Time) time.Time {
	exp := now.Add(s.cfg.SessionTTL)
	if limit := createdAt.Add(s.cfg.SessionMaxAge); exp.After(limit) {
		return limit
	}
	return exp
}

func truncPtr(s string, n int) *string {
	if s == "" {
		return nil
	}
	if len(s) > n {
		s = s[:n]
	}
	return &s
}

// Authenticate resolve o token do cookie em um usuário. A sessão é "deslizante": usá-la a renova,
// mas gravamos no máximo uma vez por hora para não escrever no banco a cada requisição.
func (s *Service) Authenticate(ctx context.Context, token string) (User, error) {
	if token == "" {
		return User{}, ErrUnauthenticated
	}
	now := s.cfg.Now()
	var sess Session
	err := s.db.WithContext(ctx).Where("token_hash = ? AND expires_at > ?", HashToken(token), now).First(&sess).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return User{}, ErrUnauthenticated
	}
	if err != nil {
		return User{}, err
	}
	// Validade absoluta: mesmo usada todo dia, a sessão morre SessionMaxAge depois do login.
	// (expires_at já nasce limitado por expiry; esta checagem cobre sessões gravadas antes da regra.)
	if !now.Before(sess.CreatedAt.Add(s.cfg.SessionMaxAge)) {
		s.db.WithContext(ctx).Where("token_hash = ?", sess.TokenHash).Delete(&Session{})
		return User{}, ErrUnauthenticated
	}
	var user User
	if err := s.db.WithContext(ctx).First(&user, "id = ?", sess.UserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) { // usuário excluído
			return User{}, ErrUnauthenticated
		}
		return User{}, err
	}
	if now.Sub(sess.LastSeenAt) > time.Hour {
		s.db.WithContext(ctx).Model(&Session{}).Where("token_hash = ?", sess.TokenHash).
			Updates(map[string]any{"last_seen_at": now, "expires_at": s.expiry(sess.CreatedAt, now)})
	}
	return user, nil
}

// Logout encerra a sessão do token. Token desconhecido não é erro (idempotente).
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.db.WithContext(ctx).Where("token_hash = ?", HashToken(token)).Delete(&Session{}).Error
}

// HouseholdRef é uma casa do usuário com o papel dele nela.
type HouseholdRef struct {
	ID   uuid.UUID
	Name string
	Role household.Role
}

// Households lista as casas ativas do usuário.
func (s *Service) Households(ctx context.Context, userID uuid.UUID) ([]HouseholdRef, error) {
	var refs []HouseholdRef
	err := s.db.WithContext(ctx).Raw(`
		SELECT h.id, h.name, m.role
		FROM household_members m
		JOIN households h ON h.id = m.household_id AND h.deleted_at IS NULL
		WHERE m.user_id = ? AND m.left_at IS NULL
		ORDER BY m.joined_at, h.name`, userID).Scan(&refs).Error
	return refs, err
}
