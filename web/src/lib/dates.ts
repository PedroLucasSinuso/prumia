// Datas de calendário como strings "AAAA-MM-DD" (igual ao backend). Nunca passam por `Date` do JavaScript,
// que carrega fuso e pode "andar um dia". Só `todayISO` consulta o relógio local.

const monthNames = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

const pad = (n: number) => String(n).padStart(2, '0')

/** Hoje no relógio do aparelho, como AAAA-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Primeiro dia do mês de uma data: "2026-10-18" -> "2026-10-01". */
export function monthOf(iso: string): string {
  return iso.slice(0, 7) + '-01'
}

export function currentMonth(now?: Date): string {
  return monthOf(todayISO(now))
}

/** Soma (ou subtrai) meses a um mês "AAAA-MM-01". */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1
  const total = y * 12 + m + n
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`
}

/** "2026-10-01" -> "outubro de 2026". */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7)) - 1
  return `${monthNames[m] ?? '?'} de ${month.slice(0, 4)}`
}

/** "2026-10-20" -> "20/10". */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** Mês na URL: "2026-10" <-> "2026-10-01". Valor inválido vira undefined. */
export function monthFromParam(param: string | null): string | undefined {
  return param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? `${param}-01` : undefined
}

export function monthToParam(month: string): string {
  return month.slice(0, 7)
}

const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Dia da semana abreviado de uma data de calendário: "2026-10-20" -> "ter". */
export function weekdayShort(iso: string): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return weekdays[d.getDay()] ?? ''
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000

/** Quantos dias de `a` até `b` (positivo se `b` é depois). Aritmética em UTC: não sofre com horário de verão. */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNumber(b) - dayNumber(a))
}

/** Soma dias a uma data: ("2026-10-31", 1) -> "2026-11-01". */
export function addDays(iso: string, n: number): string {
  const d = new Date((dayNumber(iso) + n) * 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** "2026-10-20" -> "20/10/2026". */
export function fullDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** true se for uma data de calendário real em "AAAA-MM-DD" ("2026-02-30" é falsa). */
export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))
  return d.getUTCFullYear() === Number(iso.slice(0, 4)) && d.getUTCMonth() === Number(iso.slice(5, 7)) - 1 && d.getUTCDate() === Number(iso.slice(8, 10))
}

/** Quantos dias tem o mês de uma data ("2026-02-10" -> 28). */
export function daysInMonth(iso: string): number {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate()
}

/** Dia da semana de uma data de calendário, 0 = domingo ... 6 = sábado (em UTC, sem fuso). */
export function weekdayIndex(iso: string): number {
  return new Date(dayNumber(iso) * 86_400_000).getUTCDay()
}

/** Soma meses a uma data mantendo o dia, ou o último dia do mês se ele não existir: ("2026-01-31", 1) -> "2026-02-28". */
export function addMonthsClamped(iso: string, n: number): string {
  const first = addMonths(monthOf(iso), n)
  const day = Math.min(Number(iso.slice(8, 10)), daysInMonth(first))
  return `${first.slice(0, 8)}${pad(day)}`
}

/** Mantém a data dentro de [min, max] (ambos opcionais). */
export function clampISO(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}

/** "2026-10-20" -> "terça-feira, 20 de outubro de 2026" (leitores de tela). */
export function longDate(iso: string): string {
  const names = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
  return `${names[weekdayIndex(iso)]}, ${Number(iso.slice(8, 10))} de ${monthNames[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`
}

/** Digitação com máscara: "20102026" -> "20/10/2026" (parcial enquanto digita). */
export function maskDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')
}

/** "20/10/2026" -> "2026-10-20"; undefined se incompleta ou inexistente. */
export function parseMasked(text: string): string | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!m) return undefined
  const iso = `${m[3]}-${m[2]}-${m[1]}`
  return isValidISO(iso) ? iso : undefined
}
