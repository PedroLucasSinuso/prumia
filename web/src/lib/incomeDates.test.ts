import { describe, expect, it } from 'vitest'

import { upcomingDates } from './income'

// Os itens são o que `GET /income-dates` devolve (datas conferidas contra o calendário de 2026/2027 do servidor).
const it4 = (...pairs: Array<[string, string]>) => pairs.map(([month, expectedDate]) => ({ month, expectedDate }))

describe('upcomingDates: "Próximas datas" parte de hoje, com relógio injetado', () => {
  const cases: Array<{
    name: string
    today: string
    items: Array<[string, string]>
    upcoming: string[]
    passed?: string
  }> = [
    {
      name: '5º dia útil, mês atual já passou (o caso do dono: 24/10/2026)',
      today: '2026-10-24',
      items: [['2026-10-01', '2026-10-07'], ['2026-11-01', '2026-11-09'], ['2026-12-01', '2026-12-07'], ['2027-01-01', '2027-01-08']],
      upcoming: ['2026-11-09', '2026-12-07', '2027-01-08'],
      passed: '2026-10-07',
    },
    {
      name: 'dia 28 com ajuste forward: a do mês atual ainda por vir entra na lista',
      today: '2026-10-24',
      items: [['2026-10-01', '2026-10-28'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-28'], ['2027-01-01', '2027-01-28']],
      upcoming: ['2026-10-28', '2026-11-30', '2026-12-28'],
    },
    {
      name: 'cai hoje: hoje ainda conta como próxima',
      today: '2026-10-28',
      items: [['2026-10-01', '2026-10-28'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-28'], ['2027-01-01', '2027-01-28']],
      upcoming: ['2026-10-28', '2026-11-30', '2026-12-28'],
    },
    {
      name: 'virada de ano, último dia útil',
      today: '2026-12-20',
      items: [['2026-12-01', '2026-12-31'], ['2027-01-01', '2027-01-29'], ['2027-02-01', '2027-02-26'], ['2027-03-01', '2027-03-31']],
      upcoming: ['2026-12-31', '2027-01-29', '2027-02-26'],
    },
    {
      name: 'virada de ano: dezembro já passou, janeiro é o mês atual',
      today: '2027-01-15',
      items: [['2027-01-01', '2027-01-08'], ['2027-02-01', '2027-02-05'], ['2027-03-01', '2027-03-05'], ['2027-04-01', '2027-04-07']],
      upcoming: ['2027-02-05', '2027-03-05', '2027-04-07'],
      passed: '2027-01-08',
    },
    {
      name: 'mês curto: dia 31 trava no último dia',
      today: '2027-02-10',
      items: [['2027-02-01', '2027-02-28'], ['2027-03-01', '2027-03-31'], ['2027-04-01', '2027-04-30'], ['2027-05-01', '2027-05-31']],
      upcoming: ['2027-02-28', '2027-03-31', '2027-04-30'],
    },
    {
      name: 'dia 31 em fevereiro com forward cai em março (sábado vira segunda)',
      today: '2026-02-10',
      items: [['2026-02-01', '2026-03-02'], ['2026-03-01', '2026-03-31'], ['2026-04-01', '2026-04-30'], ['2026-05-01', '2026-06-01']],
      upcoming: ['2026-03-02', '2026-03-31', '2026-04-30'],
    },
    {
      name: 'feriado: 2º dia útil de novembro pula o dia 2',
      today: '2026-11-03',
      items: [['2026-11-01', '2026-11-04'], ['2026-12-01', '2026-12-02'], ['2027-01-01', '2027-01-05'], ['2027-02-01', '2027-02-02']],
      upcoming: ['2026-11-04', '2026-12-02', '2027-01-05'],
    },
    {
      name: 'mês inicial futuro: a prévia parte dele e não há "este mês"',
      today: '2026-10-24',
      items: [['2027-03-01', '2027-03-05'], ['2027-04-01', '2027-04-07'], ['2027-05-01', '2027-05-07'], ['2027-06-01', '2027-06-07']],
      upcoming: ['2027-03-05', '2027-04-07', '2027-05-07'],
    },
  ]

  it.each(cases)('$name', ({ today, items, upcoming, passed }) => {
    const got = upcomingDates(it4(...items), today)
    expect(got.upcoming).toEqual(upcoming)
    expect(got.passedThisMonth).toBe(passed)
    expect(got.upcoming.every((d) => d >= today)).toBe(true)
  })
})
