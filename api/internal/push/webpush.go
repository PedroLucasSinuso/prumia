package push

import (
	"context"
	"io"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// VAPID é o par de chaves do servidor (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, geradas por `api push-keys`) e o contato
// que o serviço de push pode usar se algo der errado (VAPID_SUBJECT: "mailto:..." ou uma URL https).
type VAPID struct {
	PublicKey  string
	PrivateKey string
	Subject    string
}

// WebPushSender é o envio de verdade: cifra o aviso com as chaves do aparelho e faz o POST no serviço de push.
type WebPushSender struct {
	vapid  VAPID
	client *http.Client
}

func NewWebPushSender(v VAPID) *WebPushSender {
	return &WebPushSender{vapid: v, client: &http.Client{
		Timeout: 10 * time.Second,
		// Sem seguir redirecionamento: o endpoint já foi validado contra a lista de serviços conhecidos, e um
		// redirecionamento poderia levar a requisição para outro lugar.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (w *WebPushSender) Send(ctx context.Context, sub Subscription, payload []byte) (int, error) {
	resp, err := webpush.SendNotificationWithContext(ctx, payload,
		&webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth}},
		&webpush.Options{
			HTTPClient:      w.client,
			Subscriber:      w.vapid.Subject,
			VAPIDPublicKey:  w.vapid.PublicKey,
			VAPIDPrivateKey: w.vapid.PrivateKey,
			TTL:             12 * 60 * 60, // aparelho desligado: o serviço guarda o aviso por até 12 h
			Urgency:         webpush.UrgencyNormal,
		})
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10)) // esvazia para a conexão ser reaproveitada
	return resp.StatusCode, nil
}

// GenerateKeys cria um par VAPID novo (comando `api push-keys`).
func GenerateKeys() (private, public string, err error) {
	return webpush.GenerateVAPIDKeys()
}
