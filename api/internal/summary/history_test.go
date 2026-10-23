package summary

import (
	"testing"

	"github.com/google/uuid"

	"github.com/PedroLucasSinuso/prumia/api/internal/platform/caldate"
)

func ptr(d caldate.Date) *caldate.Date { return &d }

func TestHistoryRangePadraoEValidacoes(t *testing.T) {
	s := NewService(nil, func() caldate.Date { return caldate.New(2026, 10, 22) })
	f, to, err := s.HistoryRange(nil, nil)
	if err != nil || f != caldate.New(2026, 5, 1) || to != caldate.New(2026, 10, 1) {
		t.Errorf("padrão: %s a %s (%v)", f, to, err)
	}
	if f, _, _ := s.HistoryRange(nil, ptr(caldate.New(2026, 3, 1))); f != caldate.New(2025, 10, 1) {
		t.Errorf("só to: %s", f)
	}
	if _, to, _ := s.HistoryRange(ptr(caldate.New(2026, 11, 1)), nil); to != caldate.New(2027, 4, 1) {
		t.Errorf("só from: %s", to)
	}
	if _, _, err := s.HistoryRange(ptr(caldate.New(2024, 11, 1)), ptr(caldate.New(2026, 10, 1))); err != nil {
		t.Errorf("24 meses cabem: %v", err)
	}
	bad := []struct {
		name string
		f, t caldate.Date
	}{
		{"25 meses", caldate.New(2024, 10, 1), caldate.New(2026, 10, 1)},
		{"invertido", caldate.New(2026, 10, 1), caldate.New(2026, 9, 1)},
		{"dia 15", caldate.New(2026, 9, 15), caldate.New(2026, 10, 1)},
	}
	for _, b := range bad {
		if _, _, err := s.HistoryRange(ptr(b.f), ptr(b.t)); err == nil {
			t.Errorf("%s deveria ser recusado", b.name)
		}
	}
}

func TestAssembleHistoryPreencheZerosEOrdena(t *testing.T) {
	a, b := uuid.MustParse("00000000-0000-0000-0000-00000000000a"), uuid.MustParse("00000000-0000-0000-0000-00000000000b")
	f, to := caldate.New(2026, 8, 1), caldate.New(2026, 10, 1)
	h := assembleHistory(f, to, []historyRow{
		{CategoryID: a, Month: caldate.New(2026, 10, 1), Total: 1000, Paid: 1000},
		{CategoryID: b, Month: caldate.New(2026, 8, 1), Total: 5000, Series: 5000},
	})
	if len(h.Months) != 3 || !h.Months[2].Equal(to) {
		t.Fatalf("meses: %v", h.Months)
	}
	if len(h.Series) != 2 || h.Series[0].CategoryID != b {
		t.Fatalf("ordem: %+v", h.Series)
	}
	pa := h.Series[1].Points
	if len(pa) != 3 || pa[0].Total != 0 || !pa[0].Month.Equal(f) || pa[2].Total != 1000 {
		t.Errorf("pontos de a: %+v", pa)
	}
	if h.Series[0].Points[0].Series != 5000 {
		t.Errorf("parte de série: %+v", h.Series[0].Points)
	}
	if e := assembleHistory(f, to, nil); e.Series == nil || len(e.Months) != 3 {
		t.Errorf("vazio: %+v", e)
	}
}
