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
