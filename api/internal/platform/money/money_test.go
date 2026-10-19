package money

import "testing"

func TestString(t *testing.T) {
	cases := []struct {
		in   Cents
		want string
	}{
		{0, "R$ 0,00"},
		{5, "R$ 0,05"},
		{66000, "R$ 660,00"},
		{123456, "R$ 1.234,56"},
		{100000000, "R$ 1.000.000,00"},
		{-1000, "-R$ 10,00"},
		{99999, "R$ 999,99"},
		{100000, "R$ 1.000,00"},
	}
	for _, c := range cases {
		if got := c.in.String(); got != c.want {
			t.Errorf("Cents(%d) = %q, quer %q", int64(c.in), got, c.want)
		}
	}
}

func TestSplitSomaSempreOTotal(t *testing.T) {
	cases := []struct {
		total Cents
		n     int
		want  []Cents
	}{
		{396000, 6, []Cents{66000, 66000, 66000, 66000, 66000, 66000}}, // o notebook
		{10000, 3, []Cents{3333, 3333, 3334}},
		{100, 7, []Cents{14, 14, 14, 14, 14, 14, 16}},
		{1, 1, []Cents{1}},
	}
	for _, c := range cases {
		got, err := Split(c.total, c.n)
		if err != nil {
			t.Fatal(err)
		}
		var sum Cents
		for i, v := range got {
			sum += v
			if v != c.want[i] {
				t.Errorf("Split(%d,%d)[%d] = %d, quer %d", c.total, c.n, i, v, c.want[i])
			}
		}
		if sum != c.total {
			t.Errorf("Split(%d,%d) soma %d", c.total, c.n, sum)
		}
	}
}

func TestSplitErros(t *testing.T) {
	if _, err := Split(100, 0); err == nil {
		t.Error("n=0 deveria falhar")
	}
	if _, err := Split(0, 3); err == nil {
		t.Error("total=0 deveria falhar")
	}
	if _, err := Split(-5, 3); err == nil {
		t.Error("total negativo deveria falhar")
	}
}
