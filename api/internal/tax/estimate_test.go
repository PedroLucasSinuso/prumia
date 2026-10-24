package tax

import "testing"

// Valores conferidos à mão contra as tabelas oficiais de 2026 (contas no comentário de cada caso).
func TestEstimate2026(t *testing.T) {
	cases := []struct {
		name       string
		gross      int64
		deps       int
		inss, irrf int64
	}{
		// INSS: 121,575 + 115,3656 + 11,6592 = 248,5998. Base = 3000 - 607,20 (simplificado) = 2392,80 <= 2428,80: isento.
		{"R$ 3.000,00", 300000, 0, 24860, 0},
		// INSS: 121,575 + 115,3656 + 174,1716 + 90,4022 = 501,5144. Base = 5000 - 607,20 = 4392,80 x 22,5% - 675,49 = 312,89;
		// a redução (até 312,89) zera o imposto: é o "isento até R$ 5.000" da Lei 15.270.
		{"R$ 5.000,00", 500000, 0, 50151, 0},
		// INSS 641,5144. Base = 6000 - 641,51 = 5358,49 x 27,5% - 908,73 = 564,85; redução = 978,62 - 0,133145 x 6000 = 179,75.
		{"R$ 6.000,00", 600000, 0, 64151, 38510},
		// Com 2 dependentes: dedução = 641,51 + 379,18 = 1020,69; base 4979,31 x 27,5% - 908,73 = 460,58; - 179,75.
		{"R$ 6.000,00 com 2 dependentes", 600000, 2, 64151, 28083},
		// INSS 781,5144. Base 6218,49 x 27,5% - 908,73 = 801,35; redução = 978,62 - 0,133145 x 7000 = 46,60.
		{"R$ 7.000,00", 700000, 0, 78151, 75475},
		// INSS 921,5144. Base 7078,49 x 27,5% - 908,73 = 1037,85; sem redução (acima de 7.350).
		{"R$ 8.000,00", 800000, 0, 92151, 103785},
		// Teto do INSS: 988,0914. Base 9011,91 x 27,5% - 908,73 = 1569,55.
		{"R$ 10.000,00 (teto do INSS)", 1000000, 0, 98809, 156955},
		// Salário mínimo de 2026 (R$ 1.621,00 = 1ª faixa inteira): 121,575 -> 121,58.
		{"R$ 1.621,00", 162100, 0, 12158, 0},
	}
	for _, c := range cases {
		got, err := Estimate(2026, c.gross, c.deps)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got.INSSCents != c.inss || got.IRRFCents != c.irrf {
			t.Errorf("%s: INSS %d, IRRF %d; quer %d e %d", c.name, got.INSSCents, got.IRRFCents, c.inss, c.irrf)
		}
		if got.TableYear != 2026 || !got.Approximate || len(got.Sources) < 3 || got.CheckedOn == "" {
			t.Errorf("%s: metadados incompletos: %+v", c.name, got)
		}
	}
}

func TestReducaoDecresceSemSaltos(t *testing.T) {
	// Entre 5.000 e 7.350 o IRRF só pode subir quando o bruto sobe (a redução decresce linearmente, sem degrau para baixo).
	prev := int64(-1)
	for gross := int64(450000); gross <= 800000; gross += 1000 {
		r, err := Estimate(2026, gross, 0)
		if err != nil {
			t.Fatal(err)
		}
		if r.IRRFCents < prev {
			t.Fatalf("IRRF caiu de %d para %d ao subir o bruto para %d", prev, r.IRRFCents, gross)
		}
		prev = r.IRRFCents
	}
}

func TestAnoSemTabelaUsaAMaisRecente(t *testing.T) {
	r, err := Estimate(2031, 600000, 0)
	if err != nil || r.TableYear != 2026 {
		t.Fatalf("ano futuro deveria usar 2026: %+v %v", r, err)
	}
	r, err = Estimate(2019, 600000, 0)
	if err != nil || r.TableYear != 2026 {
		t.Fatalf("ano anterior a todas as tabelas usa a mais antiga: %+v %v", r, err)
	}
}

func TestEntradaInvalida(t *testing.T) {
	for _, c := range []struct {
		gross int64
		deps  int
	}{{0, 0}, {-1, 0}, {MaxGrossCents + 1, 0}, {100000, -1}, {100000, MaxDependents + 1}} {
		if _, err := Estimate(2026, c.gross, c.deps); err == nil {
			t.Errorf("Estimate(%d, %d) deveria falhar", c.gross, c.deps)
		}
	}
}
