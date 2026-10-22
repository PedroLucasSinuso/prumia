package cnpj

import "testing"

func TestValid(t *testing.T) {
	for in, want := range map[string]bool{
		"11.802.875/0001-23": true, // Powernet
		"01.695-370/0001-53": true, // CEG (máscara torta, como vem no PDF)
		"11802875000123":     true,
		"11.802.875/0001-24": false, // DV errado
		"00000000000000":     false, // repetido
		"1180287500012":      false, // 13 dígitos
		"":                   false,
	} {
		if got := Valid(in); got != want {
			t.Errorf("Valid(%q) = %v, esperado %v", in, got, want)
		}
	}
}

func TestFormat(t *testing.T) {
	if got := Format("01.695-370/0001-53"); got != "01.695.370/0001-53" {
		t.Errorf("Format = %q", got)
	}
}
