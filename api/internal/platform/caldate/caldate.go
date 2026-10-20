// Package caldate implementa a data de calendário (dia, mês, ano) sem hora nem fuso.
//
// Por que não usar time.Time? Vencimento, pagamento e competência são "dias", não instantes.
// Um time.Time carrega fuso e hora, e isso gera o clássico bug de a data "andar um dia" ao
// atravessar fusos. Aqui o tipo só tem o que o negócio precisa.
//
// Para quem vem de PHP: é o equivalente a um Carbon sempre em startOfDay e em UTC, mas que não
// permite ser outra coisa.
package caldate

import (
	"database/sql/driver"
	"fmt"
	"time"
)

const layout = "2006-01-02"

// Date é um dia do calendário. O valor zero (Date{}) significa "sem data"; use IsZero para testar.
// Em Go, um struct é passado por cópia, então Date é seguro de compartilhar (imutável na prática).
type Date struct {
	t time.Time // sempre meia-noite UTC; campo privado para ninguém quebrar a invariante
}

// New cria uma data. Dias fora do intervalo normalizam (31 de fevereiro vira 3 de março),
// como em time.Date; use ParseISO se precisar validar entrada do usuário.
func New(year int, month time.Month, day int) Date {
	return Date{t: time.Date(year, month, day, 0, 0, 0, 0, time.UTC)}
}

// FromTime descarta hora e fuso, mantendo o dia que o time.Time mostra no próprio fuso.
func FromTime(t time.Time) Date {
	y, m, d := t.Date()
	return New(y, m, d)
}

// Today devolve a data de hoje no fuso informado (ex.: America/Sao_Paulo).
func Today(loc *time.Location) Date { return FromTime(time.Now().In(loc)) }

// ParseISO lê "YYYY-MM-DD" e rejeita datas inexistentes ("2026-02-30").
func ParseISO(s string) (Date, error) {
	t, err := time.Parse(layout, s)
	if err != nil {
		return Date{}, fmt.Errorf("data inválida %q (use AAAA-MM-DD): %w", s, err)
	}
	return Date{t: t}, nil
}

func (d Date) IsZero() bool         { return d.t.IsZero() }
func (d Date) Year() int            { return d.t.Year() }
func (d Date) Month() time.Month    { return d.t.Month() }
func (d Date) Day() int             { return d.t.Day() }
func (d Date) Before(o Date) bool   { return d.t.Before(o.t) }
func (d Date) After(o Date) bool    { return d.t.After(o.t) }
func (d Date) Equal(o Date) bool    { return d.t.Equal(o.t) }
func (d Date) String() string       { return d.t.Format(layout) }
func (d Date) AddDays(n int) Date   { return Date{t: d.t.AddDate(0, 0, n)} }
func (d Date) StartOfMonth() Date   { return New(d.Year(), d.Month(), 1) }
func (d Date) IsStartOfMonth() bool { return d.Day() == 1 }
func (d Date) DaysInMonth() int     { return New(d.Year(), d.Month()+1, 0).Day() }
func (d Date) Time() time.Time      { return d.t }

// AddMonths soma meses mantendo o dia, e **trava no último dia** do mês de destino:
// 31/jan + 1 mês = 28/fev (ou 29 em bisexto). É a regra das contas "todo dia 31".
// Atenção: time.AddDate faria 31/jan + 1 mês = 3/mar, por isso não o usamos direto.
func (d Date) AddMonths(n int) Date {
	first := New(d.Year(), d.Month()+time.Month(n), 1) // dia 1 do mês de destino (Go normaliza o ano)
	day := d.Day()
	if last := first.DaysInMonth(); day > last {
		day = last
	}
	return New(first.Year(), first.Month(), day)
}

// WithDayClamped devolve o dia `day` do mês de d, travando no último dia se o mês for curto.
// Usado para gerar o vencimento de uma recorrência a partir do mês de competência.
func (d Date) WithDayClamped(day int) Date {
	if last := d.DaysInMonth(); day > last {
		day = last
	}
	return New(d.Year(), d.Month(), day)
}

// MarshalJSON / UnmarshalJSON: no JSON a data é a string "YYYY-MM-DD" (e o zero é null).
func (d Date) MarshalJSON() ([]byte, error) {
	if d.IsZero() {
		return []byte("null"), nil
	}
	return []byte(`"` + d.String() + `"`), nil
}

func (d *Date) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*d = Date{}
		return nil
	}
	if len(b) < 2 || b[0] != '"' || b[len(b)-1] != '"' {
		return fmt.Errorf("data deve ser uma string AAAA-MM-DD")
	}
	v, err := ParseISO(string(b[1 : len(b)-1]))
	if err != nil {
		return err
	}
	*d = v
	return nil
}

// Scan e Value fazem o tipo conversar com database/sql (e, por baixo, com o GORM/pgx).
// O Postgres devolve DATE como time.Time; a gente descarta a hora.
func (d *Date) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*d = Date{}
	case time.Time:
		*d = FromTime(v)
	case string:
		p, err := ParseISO(v)
		if err != nil {
			return err
		}
		*d = p
	default:
		return fmt.Errorf("caldate: não sei converter %T", src)
	}
	return nil
}

func (d Date) Value() (driver.Value, error) {
	if d.IsZero() {
		return nil, nil
	}
	return d.t, nil
}

// GormDataType diz ao GORM que o campo é uma coluna DATE (sem isso ele não sabe mapear o struct).
func (Date) GormDataType() string { return "date" }

// UnmarshalText/MarshalText: formato texto "AAAA-MM-DD", usado por query string e path.
func (d *Date) UnmarshalText(b []byte) error {
	v, err := ParseISO(string(b))
	if err != nil {
		return err
	}
	*d = v
	return nil
}

func (d Date) MarshalText() ([]byte, error) { return []byte(d.String()), nil }

// Bind satisfaz a interface runtime.Binder do código gerado (parâmetros de rota e query).
func (d *Date) Bind(src string) error { return d.UnmarshalText([]byte(src)) }
