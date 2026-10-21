package boleto

import (
	"fmt"
	"testing"
	"time"
)

var ref2026 = time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)

func TestMod10(t *testing.T) {
	cases := map[string]int{"001905009": 5, "4014481606": 9, "0680935031": 4}
	for in, want := range cases {
		if got := mod10(in); got != want {
			t.Errorf("mod10(%s) = %d, quer %d", in, got, want)
		}
	}
}

// Linha de exemplo da documentação da Febraban/BB (fator 3737, R$ 1,00). Serve de vetor independente do nosso gerador.
func TestParseBankKnownExample(t *testing.T) {
	// o boleto é de 2007: com "hoje" em 2007 a data mais próxima do fator é a da era antiga
	b, err := Parse("00190.50095 40144.816069 06809.350314 3 37370000000100", time.Date(2007, 12, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if b.Barcode != "00193373700000001000500940144816060680935031" {
		t.Errorf("código de barras = %s", b.Barcode)
	}
	if b.AmountCents != 100 {
		t.Errorf("valor = %d", b.AmountCents)
	}
	// fator 3737 = 07/10/1997 + 3737 dias = 2007-12-... (conferido abaixo por cálculo independente)
	want := time.Date(1997, 10, 7, 0, 0, 0, 0, time.UTC).AddDate(0, 0, 3737)
	if !b.DueDate.Equal(want) {
		t.Errorf("vencimento = %v, quer %v", b.DueDate, want)
	}
}

// bankLineFor monta uma linha bancária válida a partir de partes (gerador de teste, usa a mesma matemática da produção
// mas o resultado é conferido contra o vetor conhecido acima e por mutação abaixo).
func bankLineFor(bank, currency, free25 string, factor int, amount int64) string {
	body := fmt.Sprintf("%s%s%04d%010d%s", bank, currency, factor, amount, free25)
	dv := itoa(mod11(body[0:4]+body[4:], true))
	bc := body[0:4] + dv + body[4:]
	return bankLine(bc)
}

func TestParseBankRoundTrip(t *testing.T) {
	line := bankLineFor("341", "9", "1090061207727808714840100", 1200, 66000)
	if len(line) != 47 {
		t.Fatalf("tamanho %d", len(line))
	}
	b, err := Parse(line, ref2026)
	if err != nil {
		t.Fatal(err)
	}
	if b.AmountCents != 66000 {
		t.Errorf("valor = %d", b.AmountCents)
	}
	// código de barras -> linha -> código de barras
	b2, err := ParseBarcode(b.Barcode, ref2026)
	if err != nil || b2.DigitableLine != b.DigitableLine {
		t.Errorf("ParseBarcode: %v %s != %s", err, b2.DigitableLine, b.DigitableLine)
	}
}

func TestParseRejectsAnySingleDigitChange(t *testing.T) {
	line := bankLineFor("001", "9", "5009540144816060680935031", 5000, 12345)
	if _, err := Parse(line, ref2026); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < len(line); i++ {
		for d := byte('0'); d <= '9'; d++ {
			if line[i] == d {
				continue
			}
			mut := []byte(line)
			mut[i] = d
			if _, err := Parse(string(mut), ref2026); err == nil {
				// Trocar um dígito pode, raramente, cair num valor também válido apenas nos campos que não têm DV (fator/valor
				// entram no dígito geral, então qualquer troca deve falhar).
				t.Fatalf("troca na posição %d para %c foi aceita: %s", i, d, mut)
			}
		}
	}
}

func TestParseInvalid(t *testing.T) {
	for _, in := range []string{"", "123", "00190500954014481606906809350314337370000000100x1", "99999999999999999999999999999999999999999999999"} {
		if _, err := Parse(in, ref2026); err == nil {
			t.Errorf("aceitou %q", in)
		}
	}
}

func TestDueFromFactor(t *testing.T) {
	cases := []struct {
		factor int
		ref    time.Time
		want   string
	}{
		{0, ref2026, ""},
		{1000, time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC), "2025-02-22"}, // reinício do fator
		{1000, time.Date(2000, 7, 1, 0, 0, 0, 0, time.UTC), "2000-07-03"}, // era antiga
		{1530, ref2026, "2026-08-06"},                                     // 2025-02-22 + 530 dias, perto de hoje
		{9999, time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC), "2025-02-21"}, // último fator antes do reinício
	}
	for _, c := range cases {
		got := dueFromFactor(c.factor, c.ref)
		s := ""
		if !got.IsZero() {
			s = got.Format("2006-01-02")
		}
		if s != c.want {
			t.Errorf("fator %d: %s, quer %s", c.factor, s, c.want)
		}
	}
}

// collectionFor monta uma linha de arrecadação válida a partir do código de barras de 44 (calcula o geral e os blocos).
func collectionFor(segment, ident byte, amount int64, company string) string {
	body := fmt.Sprintf("8%c%c", segment, ident)  // 3 dígitos
	mid := fmt.Sprintf("%011d", amount) + company // valor (11) + resto
	rest := (body + mid)
	rest = rest[:43-0]
	useMod10 := ident == '6' || ident == '7'
	var general int
	if useMod10 {
		general = mod10(rest[:3] + rest[3:])
	} else {
		general = mod11(rest[:3]+rest[3:], false)
	}
	bc := rest[:3] + itoa(general) + rest[3:]
	return collectionLine(bc)
}

func TestParseCollection(t *testing.T) {
	for _, ident := range []byte{'6', '8'} {
		line := collectionFor('1', ident, 15075, "00000000000000000000000000000000")
		if len(line) != 48 {
			t.Fatalf("tamanho %d", len(line))
		}
		b, err := Parse(line, ref2026)
		if err != nil {
			t.Fatalf("ident %c: %v", ident, err)
		}
		if b.AmountCents != 15075 {
			t.Errorf("ident %c valor = %d", ident, b.AmountCents)
		}
		mut := []byte(line)
		mut[20] = '0' + (mut[20]-'0'+1)%10
		if _, err := Parse(string(mut), ref2026); err == nil {
			t.Errorf("ident %c: aceitou linha adulterada", ident)
		}
	}
	// ident 7 e 9: referência, sem valor em reais
	line := collectionFor('1', '7', 15075, "00000000000000000000000000000000")
	b, err := Parse(line, ref2026)
	if err != nil || b.AmountCents != 0 {
		t.Errorf("ident 7: %v valor %d", err, b.AmountCents)
	}
}
