package cnpj

import "testing"

func TestValid(t *testing.T) {
	for in, want := range map[string]bool{
		"45.678.901/0001-75": true, // empresa A
		"11.222-333/0001-81": true, // máscara fora do padrão, como aparece em PDFs
		"45678901000175":     true,
		"45.678.901/0001-76": false, // DV errado
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
	if got := Format("11.222-333/0001-81"); got != "11.222.333/0001-81" {
		t.Errorf("Format = %q", got)
	}
}
