package push

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// O envio de verdade contra um "serviço de push" local: confere que o aviso sai cifrado (aes128gcm), assinado com VAPID e
// com prazo de entrega, e que o texto não trafega em claro. As chaves do aparelho são geradas aqui (fictícias).
func TestWebPushSenderCifraEAssina(t *testing.T) {
	private, public, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	device, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	b64 := base64.RawURLEncoding.EncodeToString

	var got *http.Request
	var body []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	sender := NewWebPushSender(VAPID{PublicKey: public, PrivateKey: private, Subject: "mailto:contato@exemplo.test"})
	status, err := sender.Send(context.Background(),
		Subscription{Endpoint: srv.URL + "/aparelho", P256dh: b64(device.PublicKey().Bytes()), Auth: b64(auth)},
		[]byte(`{"title":"prumia","body":"1 vence hoje (R$ 99,90)"}`))
	if err != nil || status != http.StatusCreated {
		t.Fatalf("envio: %d %v", status, err)
	}
	if got.Method != http.MethodPost || got.URL.Path != "/aparelho" {
		t.Errorf("requisição: %s %s", got.Method, got.URL.Path)
	}
	if enc := got.Header.Get("Content-Encoding"); enc != "aes128gcm" {
		t.Errorf("Content-Encoding = %q", enc)
	}
	if a := got.Header.Get("Authorization"); !strings.HasPrefix(a, "vapid t=") || !strings.Contains(a, "k="+public) {
		t.Errorf("Authorization sem VAPID: %q", a)
	}
	if got.Header.Get("TTL") == "" || got.Header.Get("TTL") == "0" {
		t.Errorf("TTL = %q", got.Header.Get("TTL"))
	}
	if len(body) == 0 || strings.Contains(string(body), "vence hoje") || strings.Contains(string(body), "prumia") {
		t.Error("o corpo deveria estar cifrado")
	}
}

// Chave do aparelho inválida não derruba nada: vira erro.
func TestWebPushSenderChaveInvalida(t *testing.T) {
	private, public, _ := GenerateKeys()
	sender := NewWebPushSender(VAPID{PublicKey: public, PrivateKey: private, Subject: "mailto:contato@exemplo.test"})
	if _, err := sender.Send(context.Background(), Subscription{Endpoint: "https://push.exemplo.test/x", P256dh: "não-é-chave", Auth: "x"}, []byte("{}")); err == nil {
		t.Error("deveria falhar com chave inválida")
	}
}
