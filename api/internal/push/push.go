// Package push envia avisos de vencimento por Web Push: uma vez por dia, quem ligou os avisos num aparelho e tem contas
// atrasadas ou vencendo até amanhã recebe UM aviso por casa. Regras em docs/developer-guide/push-notifications.md.
//
// Web Push em uma frase: o navegador entrega ao app uma "assinatura" (uma URL do serviço de push do fabricante + chaves
// do aparelho); o servidor cifra o aviso com essas chaves e faz um POST nessa URL, assinado com o par de chaves VAPID do
// servidor. O fabricante só transporta: não consegue ler o conteúdo.
package push

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/money"
	"github.com/PedroLucasSinuso/prumia/api/internal/platform/validation"
)

// ErrDisabled: o servidor está sem chaves VAPID (o handler responde 503 push_disabled).
var ErrDisabled = errors.New("avisos por push desligados no servidor")

const (
	// MaxPerUser limita os aparelhos por pessoa (a mais antiga sai quando passa do limite).
	MaxPerUser = 10
	// DefaultDigestHour: a partir de que hora (no fuso do app) o aviso do dia pode sair.
	DefaultDigestHour = 9
	digestRetention   = 60 // dias de push_digests guardados
)

// Subscription é o que o navegador entrega em pushManager.subscribe().
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Message é o corpo do aviso, lido pelo service worker (web/public/sw.js, evento "push").
type Message struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	// Tag: avisos com a mesma tag se substituem no aparelho (o de hoje troca o de ontem, em vez de empilhar).
	Tag string `json:"tag"`
}

// Sender entrega um aviso cifrado a um aparelho. É interface porque o teste troca o envio real (que fala com o Google, a
// Mozilla ou a Apple) por um falso. Devolve o status HTTP do serviço de push; 404 e 410 significam "assinatura morta".
type Sender interface {
	Send(ctx context.Context, sub Subscription, payload []byte) (status int, err error)
}

// allowedHosts: sufixos dos serviços de push dos navegadores. O endpoint vem do cliente e o servidor faz um POST nele;
// sem esta lista, qualquer usuário logado poderia apontar o servidor para um endereço interno (SSRF).
var allowedHosts = []string{
	"fcm.googleapis.com",         // Chrome, Edge (Android/desktop), Brave...
	".push.services.mozilla.com", // Firefox
	".push.apple.com",            // Safari / PWA no iOS (web.push.apple.com)
	".notify.windows.com",        // Edge no Windows
}

// AllowedEndpoint diz se a URL é HTTPS de um serviço de push conhecido.
func AllowedEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" && u.Port() != "443" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range allowedHosts {
		if host == strings.TrimPrefix(h, ".") || strings.HasPrefix(h, ".") && strings.HasSuffix(host, h) {
			return true
		}
	}
	return false
}

type Service struct {
	db     *gorm.DB
	sender Sender // nil = desligado
	now    func() time.Time
	loc    *time.Location
	// DigestHour: hora local a partir da qual o aviso do dia sai (DefaultDigestHour).
	DigestHour int
	// AllowEndpoint: validação do endpoint (AllowedEndpoint); os testes trocam para aceitar um host falso.
	AllowEndpoint func(string) bool
	mu            sync.Mutex // um RunDue por vez (o agendador e um teste manual não se atropelam)
}

// NewService: sender nil deixa o módulo desligado (Subscribe e SendTest devolvem ErrDisabled, RunDue não faz nada).
func NewService(db *gorm.DB, sender Sender, now func() time.Time, loc *time.Location) *Service {
	return &Service{db: db, sender: sender, now: now, loc: loc, DigestHour: DefaultDigestHour, AllowEndpoint: AllowedEndpoint}
}

func (s *Service) Enabled() bool { return s.sender != nil }

// Subscribe guarda (ou atualiza) a assinatura do aparelho para o usuário, presa à sessão atual.
func (s *Service) Subscribe(ctx context.Context, userID uuid.UUID, sessionHash []byte, in Subscription) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	var v validation.Collector
	if len(in.Endpoint) > 2000 || !s.AllowEndpoint(in.Endpoint) {
		v.Add("endpoint", "endereço de push não reconhecido")
	}
	if in.P256dh == "" || len(in.P256dh) > 200 {
		v.Add("keys.p256dh", "chave inválida")
	}
	if in.Auth == "" || len(in.Auth) > 100 {
		v.Add("keys.auth", "chave inválida")
	}
	if err := v.Err(); err != nil {
		return err
	}
	// Transação: gravar e podar o excesso acontecem juntos (em PHP/Laravel seria DB::transaction).
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// O mesmo aparelho pode trocar de conta: o endpoint é único e passa a ser de quem assinou por último.
		if err := tx.Exec(`
			INSERT INTO push_subscriptions (user_id, session_hash, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (endpoint) DO UPDATE
			   SET user_id = EXCLUDED.user_id, session_hash = EXCLUDED.session_hash, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
			userID, sessionHash, in.Endpoint, in.P256dh, in.Auth).Error; err != nil {
			return fmt.Errorf("gravando assinatura de push: %w", err)
		}
		return tx.Exec(`
			DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN (
				SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, id LIMIT ?)`,
			userID, userID, MaxPerUser).Error
	})
}

// Unsubscribe apaga a assinatura do usuário com este endpoint (sem erro se não existir).
func (s *Service) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	return s.db.WithContext(ctx).Exec(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`, userID, endpoint).Error
}

type subRow struct {
	ID       uuid.UUID
	Endpoint string
	P256dh   string
	Auth     string
}

// activeSubs: aparelhos do usuário cuja sessão ainda vale.
func (s *Service) activeSubs(ctx context.Context, userID uuid.UUID) ([]subRow, error) {
	var subs []subRow
	err := s.db.WithContext(ctx).Raw(`
		SELECT p.id, p.endpoint, p.p256dh, p.auth
		  FROM push_subscriptions p
		  JOIN sessions se ON se.token_hash = p.session_hash AND se.expires_at > ?
		 WHERE p.user_id = ? ORDER BY p.created_at, p.id`, s.now(), userID).Scan(&subs).Error
	return subs, err
}

// deliver manda a mensagem a cada aparelho e devolve quantos aceitaram. Assinatura morta (404/410) é apagada. `failed`
// indica falha passageira (rede, 5xx, 429) em algum aparelho: quem chama decide se tenta de novo depois.
func (s *Service) deliver(ctx context.Context, subs []subRow, msg Message) (sent int, failed bool) {
	payload, _ := json.Marshal(msg) // struct só de strings: não falha
	for _, sub := range subs {
		status, err := s.sender.Send(ctx, Subscription{Endpoint: sub.Endpoint, P256dh: sub.P256dh, Auth: sub.Auth}, payload)
		switch {
		case err == nil && status >= 200 && status < 300:
			sent++
		case err == nil && (status == 404 || status == 410):
			// O navegador desinstalou o app ou revogou a permissão: a assinatura não volta.
			s.db.WithContext(ctx).Exec(`DELETE FROM push_subscriptions WHERE id = ?`, sub.ID)
		default:
			failed = true
		}
	}
	return sent, failed
}

// SendTest manda um aviso de teste aos aparelhos do usuário e devolve quantos aceitaram.
func (s *Service) SendTest(ctx context.Context, userID uuid.UUID) (int, error) {
	if !s.Enabled() {
		return 0, ErrDisabled
	}
	subs, err := s.activeSubs(ctx, userID)
	if err != nil {
		return 0, err
	}
	sent, _ := s.deliver(ctx, subs, Message{Title: "prumia", Body: "Os avisos estão funcionando neste aparelho.", URL: "/", Tag: "prumia-teste"})
	return sent, nil
}

// Pending é o que a pessoa tem a pagar numa casa, visto de "hoje".
type Pending struct {
	UserID        uuid.UUID
	HouseholdID   uuid.UUID
	HouseholdName string
	Houses        int // de quantas casas a pessoa participa (com mais de uma, o título leva o nome da casa)
	OverdueCount  int
	OverdueCents  money.Cents
	TodayCount    int
	TodayCents    money.Cents
	TomorrowCount int
	TomorrowCents money.Cents
}

// DigestMessage monta o texto do aviso. Fica separada (e exportada) para ser testada sem banco.
func DigestMessage(p Pending) Message {
	var parts []string
	add := func(n int, cents money.Cents, one, many string) {
		if n == 0 {
			return
		}
		label := many
		if n == 1 {
			label = one
		}
		parts = append(parts, fmt.Sprintf("%d %s (%s)", n, label, cents))
	}
	add(p.OverdueCount, p.OverdueCents, "conta atrasada", "contas atrasadas")
	add(p.TodayCount, p.TodayCents, "vence hoje", "vencem hoje")
	add(p.TomorrowCount, p.TomorrowCents, "vence amanhã", "vencem amanhã")
	title := "prumia"
	if p.Houses > 1 {
		title = "prumia · " + p.HouseholdName
	}
	return Message{Title: title, Body: strings.Join(parts, " · "), URL: "/", Tag: "prumia-vencimentos-" + p.HouseholdID.String()}
}

// RunDue envia os avisos do dia que ainda não saíram. É chamado de tempos em tempos pelo agendador (cmd/api): antes da
// DigestHour não faz nada; depois, cada (pessoa, casa) recebe no máximo um aviso por dia (push_digests). Devolve quantos
// avisos (pessoa+casa) foram entregues.
func (s *Service) RunDue(ctx context.Context) (int, error) {
	if !s.Enabled() {
		return 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock() // defer: destrava ao sair, com erro ou sem (como um finally)

	now := s.now().In(s.loc)
	if now.Hour() < s.DigestHour {
		return 0, nil
	}
	today := caldate.FromTime(now)
	tomorrow := today.AddDays(1)
	db := s.db.WithContext(ctx)

	// Uma consulta só para todas as pessoas e casas (sem N+1): quem tem aparelho com sessão válida, é membro ativo, tem
	// conta pendente até amanhã e ainda não foi avisado hoje nessa casa. Sempre com household_id e deleted_at IS NULL.
	var rows []Pending
	err := db.Raw(`
		SELECT m.user_id, m.household_id, h.name AS household_name,
		       (SELECT count(*) FROM household_members m2 JOIN households h2 ON h2.id = m2.household_id AND h2.deleted_at IS NULL
		         WHERE m2.user_id = m.user_id AND m2.left_at IS NULL) AS houses,
		       count(*) FILTER (WHERE i.due_date < @today)                              AS overdue_count,
		       coalesce(sum(i.amount_cents) FILTER (WHERE i.due_date < @today), 0)      AS overdue_cents,
		       count(*) FILTER (WHERE i.due_date = @today)                              AS today_count,
		       coalesce(sum(i.amount_cents) FILTER (WHERE i.due_date = @today), 0)      AS today_cents,
		       count(*) FILTER (WHERE i.due_date = @tomorrow)                           AS tomorrow_count,
		       coalesce(sum(i.amount_cents) FILTER (WHERE i.due_date = @tomorrow), 0)   AS tomorrow_cents
		  FROM household_members m
		  JOIN households h ON h.id = m.household_id AND h.deleted_at IS NULL
		  JOIN invoices i   ON i.household_id = m.household_id AND i.deleted_at IS NULL AND i.paid_at IS NULL AND i.due_date <= @tomorrow
		 WHERE m.left_at IS NULL
		   AND EXISTS (SELECT 1 FROM push_subscriptions p JOIN sessions se ON se.token_hash = p.session_hash AND se.expires_at > @now
		                WHERE p.user_id = m.user_id)
		   AND NOT EXISTS (SELECT 1 FROM push_digests d WHERE d.user_id = m.user_id AND d.household_id = m.household_id AND d.day = @today)
		 GROUP BY m.user_id, m.household_id, h.name
		 ORDER BY m.user_id, h.name, m.household_id`,
		map[string]any{"today": today, "tomorrow": tomorrow, "now": s.now()}).Scan(&rows).Error
	if err != nil {
		return 0, fmt.Errorf("buscando avisos do dia: %w", err)
	}

	delivered := 0
	for _, p := range rows {
		subs, err := s.activeSubs(ctx, p.UserID)
		if err != nil {
			return delivered, err
		}
		sent, failed := s.deliver(ctx, subs, DigestMessage(p))
		if sent == 0 && failed {
			continue // nada chegou e a falha é passageira: a próxima rodada tenta de novo
		}
		if err := db.Exec(`INSERT INTO push_digests (user_id, household_id, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
			p.UserID, p.HouseholdID, today).Error; err != nil {
			return delivered, fmt.Errorf("registrando aviso enviado: %w", err)
		}
		if sent > 0 {
			delivered++
		}
	}
	// Faxina: o registro de avisos antigos não serve para nada.
	db.Exec(`DELETE FROM push_digests WHERE day < ?`, today.AddDays(-digestRetention))
	return delivered, nil
}
