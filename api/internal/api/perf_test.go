package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm/logger"
)

// Medição de desempenho com volume realista. NÃO roda no `go test` normal (é lenta e só imprime números):
//
//	PRUMIA_PERF=1 go test ./internal/api/ -run TestDesempenho -v
//
// Cenário: 10 casas com 5 mil invoices cada (2 anos, ~60% pagas, 5% excluídas, 10% com boleto), e na casa medida
// também compras parceladas, recorrências e fontes de receita criadas pela API. Mede cada listagem pela API inteira
// (middleware de sessão e casa incluídos): mediana de 15 chamadas e o número de consultas SQL por requisição (N+1
// aparece aqui como "consultas cresce com o tamanho da lista"). Com PRUMIA_PERF_SQL=1 imprime cada consulta e o tempo
// dela (só neste teste, com dados fictícios: este contador não esconde os valores como o logger de verdade).
func TestDesempenhoComVolumeRealista(t *testing.T) {
	if os.Getenv("PRUMIA_PERF") == "" {
		t.Skip("defina PRUMIA_PERF=1 para medir")
	}
	a := newApp(t, opts{openRegistration: true, now: func() time.Time { return today }})
	a.hs.MaxPerUser = 20 // o teste cria 9 casas extras; o limite padrão (5) as recusaria
	c, house := a.register("Ana", "ana@x.com", "Casa medida")
	cat := mustCat(a, c, house)
	ana := a.uid("ana@x.com")
	for i := 0; i < 40; i++ {
		if _, r := a.newPurchase(c, house, cat, map[string]any{"description": fmt.Sprintf("Compra %d", i), "installmentsCount": 12}); r.Code != 201 {
			t.Fatalf("compra: %d %s", r.Code, r.Body)
		}
	}
	for i := 0; i < 10; i++ {
		if _, r := a.newRecurrence(c, house, cat, map[string]any{"description": fmt.Sprintf("Fixa %d", i), "startMonth": "2025-01-01"}); r.Code != 201 {
			t.Fatalf("recorrência: %d %s", r.Code, r.Body)
		}
	}
	for i := 0; i < 3; i++ {
		if _, r := a.newSource(c, house, ana, map[string]any{"name": fmt.Sprintf("Fonte %d", i), "startMonth": "2025-01-01"}); r.Code != 201 {
			t.Fatalf("fonte: %d %s", r.Code, r.Body)
		}
	}
	houses := []string{house}
	for i := 0; i < 9; i++ { // outras casas (criadas pela própria Ana: só importa o volume da tabela)
		var h struct{ Id string }
		r := a.do("POST", "/api/households", map[string]any{"name": fmt.Sprintf("Casa %d", i)}, c)
		if r.Code != 201 {
			t.Fatalf("casa: %d %s", r.Code, r.Body)
		}
		r.json(&h)
		houses = append(houses, h.Id)
	}
	start := time.Now()
	for _, h := range houses {
		seedInvoices(t, a, h, 5000)
	}
	a.db.Exec("ANALYZE")
	var total int64
	a.db.Raw("SELECT count(*) FROM invoices").Scan(&total)
	t.Logf("semeadas %d invoices em %d casas (%s)", total, len(houses), time.Since(start).Round(time.Millisecond))

	// contador de consultas: o logger do GORM recebe um Trace por consulta executada
	var queries, sqlNanos atomic.Int64
	a.db.Logger = countingLogger{Interface: a.db.Logger, n: &queries, ns: &sqlNanos}

	base := "/api/households/" + house
	endpoints := []string{
		base + "/invoices?month=2026-10-01&limit=200",
		base + "/invoices?month=2025-06-01&limit=200",
		base + "/invoices?status=overdue&limit=200",
		base + "/invoices?q=conta%2012&limit=50",
		base + "/summary?month=2026-10-01",
		base + "/summary/categories?from=2025-11-01&to=2026-10-01",
		base + "/incomes?month=2026-10-01",
		base + "/income-sources",
		base + "/purchases?limit=50",
		base + "/recurrences",
		base + "/members",
		base + "/categories",
	}
	t.Logf("%-40s %8s %8s %8s %9s %9s", "rota", "mediana", "p90", "SQL/req", "tempo SQL", "resposta")
	for _, ep := range endpoints {
		var times []time.Duration
		var perReq int64
		var size int
		var sqlTimes []time.Duration
		for i := 0; i < 15; i++ {
			queries.Store(0)
			sqlNanos.Store(0)
			t0 := time.Now()
			r := a.do("GET", ep, nil, c)
			times = append(times, time.Since(t0))
			if r.Code != http.StatusOK {
				t.Fatalf("%s: %d %s", ep, r.Code, r.Body)
			}
			perReq = queries.Load()
			sqlTimes = append(sqlTimes, time.Duration(sqlNanos.Load()))
			size = r.Body.Len()
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		sort.Slice(sqlTimes, func(i, j int) bool { return sqlTimes[i] < sqlTimes[j] })
		t.Logf("%-40s %8s %8s %8d %9s %8dB", strings.TrimPrefix(ep, base), times[7].Round(10*time.Microsecond),
			times[13].Round(10*time.Microsecond), perReq, sqlTimes[7].Round(10*time.Microsecond), size)
	}

	// Planos das consultas principais (o que o Postgres de fato faz).
	plans := map[string]string{
		"lista do mês": `SELECT * FROM invoices WHERE household_id = @h AND competence_month = '2026-10-01' AND deleted_at IS NULL
			ORDER BY due_date, id LIMIT 201`,
		"atrasadas": `SELECT * FROM invoices WHERE household_id = @h AND paid_at IS NULL AND due_date < '2026-10-18' AND deleted_at IS NULL
			ORDER BY due_date, id LIMIT 201`,
		"busca": `SELECT * FROM invoices WHERE household_id = @h AND description ILIKE '%conta 12%' AND deleted_at IS NULL
			ORDER BY due_date, id LIMIT 51`,
		"resumo por categoria": `SELECT category_id, sum(amount_cents) FROM invoices WHERE household_id = @h AND competence_month = '2026-10-01'
			AND deleted_at IS NULL GROUP BY category_id`,
		"boletos da página": `SELECT * FROM invoice_boletos WHERE household_id = @h AND invoice_id IN
			(SELECT id FROM invoices WHERE household_id = @h AND competence_month = '2026-10-01' LIMIT 200)`,
		"compras": `SELECT * FROM purchases WHERE household_id = @h AND deleted_at IS NULL ORDER BY purchase_date DESC, id DESC LIMIT 51`,
	}
	names := make([]string, 0, len(plans))
	for k := range plans {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, name := range names {
		rows, err := a.db.WithContext(context.Background()).Raw("EXPLAIN (ANALYZE, BUFFERS) "+plans[name], map[string]any{"h": house}).Rows()
		if err != nil {
			t.Fatal(err)
		}
		var lines []string
		for rows.Next() {
			var l string
			_ = rows.Scan(&l)
			lines = append(lines, "    "+l)
		}
		rows.Close()
		t.Logf("EXPLAIN %s:\n%s", name, strings.Join(lines, "\n"))
	}
}

// seedInvoices insere n invoices avulsas na casa em 2 anos (2025-01 a 2026-12), por SQL (rápido).
func seedInvoices(t *testing.T, a *app, house string, n int) {
	t.Helper()
	err := a.db.Exec(`
		WITH cats AS (SELECT array_agg(id ORDER BY sort_order) AS ids FROM categories WHERE household_id = @h),
		     u AS (SELECT user_id FROM household_members WHERE household_id = @h LIMIT 1),
		     w AS (SELECT id FROM wallets WHERE household_id = @h AND is_default),
		     g AS (SELECT s, (date '2025-01-01' + (s % 730))::date AS d, 1000 + (s * 37 % 50000) AS amt FROM generate_series(1, @n) s)
		INSERT INTO invoices (household_id, category_id, description, amount_cents, due_date, competence_month, created_by,
		                      paid_at, paid_wallet_id, paid_amount_cents, paid_by_user_id, deleted_at)
		SELECT @h, cats.ids[1 + g.s % array_length(cats.ids, 1)], 'Conta ' || g.s, g.amt, g.d, date_trunc('month', g.d)::date, u.user_id,
		       CASE WHEN g.s % 10 < 6 THEN g.d END, CASE WHEN g.s % 10 < 6 THEN w.id END,
		       CASE WHEN g.s % 10 < 6 THEN g.amt END, CASE WHEN g.s % 10 < 6 THEN u.user_id END,
		       CASE WHEN g.s % 20 = 0 THEN now() END
		FROM g, cats, u, w`, map[string]any{"h": house, "n": n}).Error
	if err != nil {
		t.Fatal(err)
	}
	// 10% com boleto (linha digitável fictícia, só para o volume da tabela)
	err = a.db.Exec(`
		INSERT INTO invoice_boletos (invoice_id, household_id, digitable_line)
		SELECT id, household_id, lpad((abs(hashtext(id::text)))::text, 47, '0')
		FROM invoices WHERE household_id = @h AND abs(hashtext(id::text)) % 10 = 0`, map[string]any{"h": house}).Error
	if err != nil {
		t.Fatal(err)
	}
}

type countingLogger struct {
	logger.Interface
	n, ns *atomic.Int64
}

func (l countingLogger) LogMode(level logger.LogLevel) logger.Interface {
	return countingLogger{Interface: l.Interface.LogMode(level), n: l.n, ns: l.ns}
}

func (l countingLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	l.n.Add(1)
	l.ns.Add(int64(time.Since(begin)))
	if os.Getenv("PRUMIA_PERF_SQL") != "" {
		sql, _ := fc()
		fmt.Printf("SQL %8s %.110s\n", time.Since(begin).Round(time.Microsecond), strings.Join(strings.Fields(sql), " "))
	}
	l.Interface.Trace(ctx, begin, fc, err)
}
