package push

import (
	"testing"

	"github.com/google/uuid"
)

// O endpoint vem do navegador e o servidor faz POST nele: só HTTPS de serviço de push conhecido (proteção contra SSRF).
func TestAllowedEndpoint(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://fcm.googleapis.com/fcm/send/abc":                true,
		"https://updates.push.services.mozilla.com/wpush/v2/abc": true,
		"https://web.push.apple.com/abc":                         true,
		"https://db5p.notify.windows.com/w/?token=abc":           true,
		"https://FCM.googleapis.com/fcm/send/abc":                true,
		"http://fcm.googleapis.com/fcm/send/abc":                 false, // sem TLS
		"https://fcm.googleapis.com.exemplo.test/x":              false, // sufixo falso
		"https://exemplo.test/fcm.googleapis.com":                false,
		"https://evilpush.apple.com.exemplo.test/":               false,
		"https://notfcm.googleapis.com/x":                        false, // fcm é host exato, não sufixo
		"https://127.0.0.1/x":                                    false,
		"https://localhost:8080/x":                               false,
		"https://db:5432/":                                       false,
		"https://user:senha@fcm.googleapis.com/x":                false,
		"https://fcm.googleapis.com:8443/x":                      false,
		"ftp://fcm.googleapis.com/x":                             false,
		"":                                                       false,
		"não é url":                                              false,
	} {
		if got := AllowedEndpoint(raw); got != want {
			t.Errorf("AllowedEndpoint(%q) = %v, quer %v", raw, got, want)
		}
	}
}

func TestDigestMessage(t *testing.T) {
	house := uuid.New()
	for name, tc := range map[string]struct {
		p           Pending
		title, body string
	}{
		"uma atrasada":       {Pending{OverdueCount: 1, OverdueCents: 15000, Houses: 1}, "prumia", "1 conta atrasada (R$ 150,00)"},
		"tudo junto, plural": {Pending{OverdueCount: 2, OverdueCents: 30050, TodayCount: 1, TodayCents: 9990, TomorrowCount: 3, TomorrowCents: 123456, Houses: 1}, "prumia", "2 contas atrasadas (R$ 300,50) · 1 vence hoje (R$ 99,90) · 3 vencem amanhã (R$ 1.234,56)"},
		"só amanhã":          {Pending{TomorrowCount: 1, TomorrowCents: 100, Houses: 1}, "prumia", "1 vence amanhã (R$ 1,00)"},
		"mais de uma casa":   {Pending{TodayCount: 2, TodayCents: 200, Houses: 2, HouseholdName: "Casa A"}, "prumia · Casa A", "2 vencem hoje (R$ 2,00)"},
	} {
		tc.p.HouseholdID = house
		m := DigestMessage(tc.p)
		if m.Title != tc.title || m.Body != tc.body || m.URL != "/" || m.Tag != "prumia-vencimentos-"+house.String() {
			t.Errorf("%s: %+v", name, m)
		}
	}
}
