// Banco em memória da demonstração: uma "Casa Exemplo" com dados FICTÍCIOS, datas relativas a hoje. Some ao recarregar.
// As regras imitam o servidor (api/internal/...): séries de parcelas e contas fixas, receitas geradas pela fonte, recebida
// = data chegou e ninguém disse "não caiu", saldo que continua de um mês para o outro, reserva de emergência.
import { addMonths, currentMonth, daysInMonth, todayISO } from '../lib/dates'
import type { Category, DateRule, Deduction, Income, IncomeSource, Invoice, Member, Payee, Recurrence, Transfer, Wallet, WalletAdjustment } from '../api/types'
import { expectedDate } from './calendar'

const uid = () => crypto.randomUUID()

export type InvoiceRec = Omit<Invoice, 'status' | 'series'> & {
  deletedAt?: string
  purchaseId?: string
  recurrenceId?: string
  installmentNumber?: number
  installmentsCount?: number
}
export type PurchaseRec = { id: string; categoryId: string; responsibleUserId?: string | null; description: string; purchaseDate: string; totalAmountCents: number; installmentsCount: number; notes?: string | null }
export type RecurrenceRec = Omit<Recurrence, 'generatedThrough'> & { deletedAt?: string }
export type IncomeRec = Omit<Income, 'netAmountCents' | 'received' | 'receivedAt' | 'repeats' | 'repeatsUntil'> & {
  /** "Caiu" marcado antes da data esperada (o dia informado). */
  receivedEarly?: string
  deletedAt?: string
}
export type SourceRec = Omit<IncomeSource, 'generatedThrough' | 'dayOfMonth'> & { deletedAt?: string }
export type TransferRec = Transfer & { deletedAt?: string }
export type AdjustmentRec = WalletAdjustment & { deletedAt?: string }
export type WalletRec = Wallet & { countsAsReserve?: boolean }

export type State = {
  me: { id: string; name: string; email: string; theme: string }
  house: { id: string; name: string; createdAt: string }
  members: Member[]
  wallets: WalletRec[]
  categories: Category[]
  payees: Payee[]
  invoices: InvoiceRec[]
  purchases: PurchaseRec[]
  recurrences: RecurrenceRec[]
  sources: SourceRec[]
  incomes: IncomeRec[]
  transfers: TransferRec[]
  adjustments: AdjustmentRec[]
  reserveTargetMonths: number | null
}

export let db: State

// ---------- regras ----------

export const today = () => todayISO()
export const thisMonth = () => currentMonth()
/** Até onde as séries ficam geradas (como o servidor: 12 meses à frente, estendido sob demanda). */
let horizon = ''

export function dayIn(month: string, day: number) {
  return `${month.slice(0, 8)}${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`
}

export function netOf(i: Pick<IncomeRec, 'grossAmountCents' | 'deductions'>) {
  return i.grossAmountCents - i.deductions.reduce((s, d) => s + d.amountCents, 0)
}

export function isReceived(i: IncomeRec) {
  return !i.held && (Boolean(i.receivedEarly) || i.expectedDate <= today())
}

export function toIncome(i: IncomeRec): Income {
  const src = i.sourceId ? db.sources.find((s) => s.id === i.sourceId) : undefined
  const received = isReceived(i)
  const { receivedEarly, deletedAt: _d, ...rest } = i
  return {
    ...rest,
    netAmountCents: netOf(i),
    received,
    receivedAt: received ? (receivedEarly ?? i.expectedDate) : null,
    repeats: Boolean(src && !src.deletedAt && (!src.endMonth || src.endMonth > i.competenceMonth)),
    repeatsUntil: src?.endMonth ?? null,
  }
}

export function statusOf(inv: InvoiceRec): Invoice['status'] {
  if (inv.paid) return 'paid'
  return inv.dueDate < today() ? 'overdue' : 'pending'
}

export function toInvoice(inv: InvoiceRec): Invoice {
  const { deletedAt: _d, purchaseId, recurrenceId, installmentNumber, installmentsCount, ...rest } = inv
  const series = purchaseId
    ? { kind: 'installment' as const, purchaseId, installmentNumber, installmentsCount }
    : recurrenceId
      ? { kind: 'recurrence' as const, recurrenceId }
      : null
  return { ...rest, status: statusOf(inv), series }
}

function genRecurrence(r: RecurrenceRec, until: string) {
  if (r.deletedAt) return
  const last = r.endMonth && r.endMonth < until ? r.endMonth : until
  for (let m = r.startMonth; m <= last; m = addMonths(m, 1)) {
    // Ocorrência excluída não volta (a linha excluída continua guardada)
    if (db.invoices.some((i) => i.recurrenceId === r.id && i.competenceMonth === m)) continue
    db.invoices.push({
      id: uid(), categoryId: r.categoryId, responsibleUserId: r.responsibleUserId ?? null, payeeId: null, description: r.description,
      amountCents: r.amountCents, dueDate: dayIn(m, r.dayOfMonth), competenceMonth: m, paid: null, boleto: null, notes: r.notes ?? null,
      recurrenceId: r.id,
    })
  }
}

export function incomeFromSource(s: SourceRec, month: string): IncomeRec {
  const rule: DateRule = s.dateRule
  return {
    id: uid(), sourceId: s.id, userId: s.userId, kind: s.kind, description: s.name, walletId: s.walletId, competenceMonth: month,
    expectedDate: expectedDate(rule, month), amountMode: s.amountMode, grossAmountCents: s.grossAmountCents,
    unitPriceCents: s.unitPriceCents ?? null, quantity: null, unitLabel: s.unitLabel ?? null, dateRule: rule,
    deductions: s.deductions.map((d) => ({ ...d })), held: false, notes: s.notes ?? null,
  }
}

function genSource(s: SourceRec, until: string) {
  if (s.deletedAt) return
  const last = s.endMonth && s.endMonth < until ? s.endMonth : until
  for (let m = s.startMonth; m <= last; m = addMonths(m, 1)) {
    if (db.incomes.some((i) => i.sourceId === s.id && i.competenceMonth === m)) continue
    db.incomes.push(incomeFromSource(s, m))
  }
}

/** Gera parcelas, contas fixas e receitas até `month` (mínimo: 12 meses à frente), como o servidor faz ao ler. */
export function ensureHorizon(month = thisMonth()) {
  const until = [addMonths(thisMonth(), 12), month].sort().pop()!
  if (until <= horizon) return
  horizon = until
  db.recurrences.forEach((r) => genRecurrence(r, until))
  db.sources.forEach((s) => genSource(s, until))
}

export function generatedThrough() {
  return horizon || addMonths(thisMonth(), 12)
}

export function regenerate() {
  const h = horizon
  horizon = ''
  ensureHorizon(h || undefined)
}

export function createInstallments(p: PurchaseRec, firstDue: string, fixedAmount?: number) {
  const n = p.installmentsCount
  const base = Math.floor(p.totalAmountCents / n)
  for (let k = 1; k <= n; k++) {
    const amount = fixedAmount ?? (k === n ? p.totalAmountCents - base * (n - 1) : base)
    const due = addMonthsKeepingDay(firstDue, k - 1)
    db.invoices.push({
      id: uid(), categoryId: p.categoryId, responsibleUserId: p.responsibleUserId ?? null, payeeId: null,
      description: `${p.description} (${k}/${n})`, amountCents: amount, dueDate: due, competenceMonth: `${due.slice(0, 8)}01`,
      paid: null, boleto: null, notes: p.notes ?? null, purchaseId: p.id, installmentNumber: k, installmentsCount: n,
    })
  }
}

export function addMonthsKeepingDay(iso: string, n: number) {
  return dayIn(addMonths(`${iso.slice(0, 8)}01`, n), Number(iso.slice(8, 10)))
}

// ---------- saldos (mesma conta do servidor: internal/summary) ----------

export type Balance = {
  carryOver: number; expected: number; received: number; paid: number; pending: number; transfersIn: number; transfersOut: number; adjustments: number
}

/** Carteira em que uma conta pendente deve sair: a padrão da categoria (ou da principal); sem ela, a padrão da casa. */
export function pendingWalletOf(inv: InvoiceRec) {
  const cat = db.categories.find((c) => c.id === inv.categoryId)
  const parent = cat?.parentId ? db.categories.find((c) => c.id === cat.parentId) : undefined
  return cat?.defaultWalletId ?? parent?.defaultWalletId ?? db.wallets.find((w) => w.isDefault)!.id
}

const live = <T extends { deletedAt?: string }>(xs: T[]) => xs.filter((x) => !x.deletedAt)

export function walletBalance(w: WalletRec, month: string): Balance {
  const start = w.openingBalanceMonth ?? undefined
  const counts = (m: string) => !start || m >= start
  const b: Balance = { carryOver: start && month < start ? 0 : w.openingBalanceCents, expected: 0, received: 0, paid: 0, pending: 0, transfersIn: 0, transfersOut: 0, adjustments: 0 }
  for (const i of live(db.incomes)) {
    if (i.walletId !== w.id || !counts(i.competenceMonth)) continue
    const net = netOf(i)
    if (i.competenceMonth < month) { if (isReceived(i)) b.carryOver += net }
    else if (i.competenceMonth === month) { b.expected += net; if (isReceived(i)) b.received += net }
  }
  for (const inv of live(db.invoices)) {
    if (inv.paid && inv.paid.walletId === w.id && counts(inv.competenceMonth)) {
      if (inv.competenceMonth < month) b.carryOver -= inv.paid.amountCents
      else if (inv.competenceMonth === month) b.paid += inv.paid.amountCents
    }
    if (!inv.paid && inv.competenceMonth === month && pendingWalletOf(inv) === w.id) b.pending += inv.amountCents
  }
  for (const t of live(db.transfers)) {
    if (!counts(t.competenceMonth)) continue
    const sign = t.toWalletId === w.id ? 1 : t.fromWalletId === w.id ? -1 : 0
    if (!sign) continue
    if (t.competenceMonth < month) b.carryOver += sign * t.amountCents
    else if (t.competenceMonth === month) { if (sign > 0) b.transfersIn += t.amountCents; else b.transfersOut += t.amountCents }
  }
  for (const a of live(db.adjustments)) {
    if (a.walletId !== w.id || !counts(a.competenceMonth)) continue
    if (a.competenceMonth < month) b.carryOver += a.amountCents
    else if (a.competenceMonth === month) b.adjustments += a.amountCents
  }
  return b
}

export const balanceOf = (b: Balance) => b.carryOver + b.received - b.paid + b.transfersIn - b.transfersOut + b.adjustments

// ---------- casa de exemplo ----------

const DED = (inss: number, irrf: number): Deduction[] => [
  { kind: 'inss', name: 'INSS', amountCents: inss },
  { kind: 'irrf', name: 'IRRF', amountCents: irrf },
]

export function reset() {
  horizon = ''
  const M = thisMonth()
  const prev2 = addMonths(M, -2)
  const prev = addMonths(M, -1)
  const ana = uid()
  const beto = uid()
  const now = new Date().toISOString()
  const w = (name: string, extra: Partial<WalletRec>): WalletRec => ({
    id: uid(), name, kind: 'regular', isDefault: false, warnOnOverdraft: true, openingBalanceCents: 0, openingBalanceMonth: null,
    sortOrder: 0, archived: false, ...extra,
  })
  const geral = w('Geral', { isDefault: true, warnOnOverdraft: false, openingBalanceCents: 60000, openingBalanceMonth: prev2 })
  const vr = w('Benefício', { sortOrder: 1, openingBalanceMonth: prev2 })
  const reserva = w('Reserva', { sortOrder: 2, openingBalanceCents: 780000, openingBalanceMonth: prev2, countsAsReserve: true })
  const cdb = w('CDB', { sortOrder: 3, kind: 'investment', institution: 'Banco Exemplo', openingBalanceCents: 1500000, openingBalanceMonth: prev2, countsAsReserve: true })
  const cat = (name: string, extra: Partial<Category> = {}): Category => ({ id: uid(), name, isEssential: false, sortOrder: 0, archived: false, ...extra })
  const moradia = cat('Moradia', { isEssential: true, sortOrder: 0 })
  const mercado = cat('Mercado', { isEssential: true, sortOrder: 1, defaultWalletId: vr.id })
  const contas = cat('Contas da casa', { isEssential: true, sortOrder: 2 })
  const luz = cat('Luz', { isEssential: true, parentId: contas.id })
  const internet = cat('Internet', { isEssential: true, parentId: contas.id, sortOrder: 1 })
  const transporte = cat('Transporte', { isEssential: true, sortOrder: 3 })
  const saude = cat('Saúde', { isEssential: true, sortOrder: 4 })
  const lazer = cat('Lazer', { sortOrder: 5 })
  const compras = cat('Compras', { sortOrder: 6 })
  const payee = (name: string, cnpj: string | null): Payee => ({ id: uid(), name, cnpj, legalName: null, defaultCategoryId: null, archived: false })
  const imob = payee('Imobiliária Exemplo', null)
  const energia = payee('Energia Exemplo', null)

  db = {
    me: { id: ana, name: 'Ana', email: 'ana@exemplo.com', theme: 'marfim' },
    house: { id: uid(), name: 'Casa Exemplo', createdAt: now },
    members: [
      { userId: ana, name: 'Ana', email: 'ana@exemplo.com', role: 'admin', joinedAt: now },
      { userId: beto, name: 'Beto', email: 'beto@exemplo.com', role: 'member', joinedAt: now },
    ],
    wallets: [geral, vr, reserva, cdb],
    categories: [moradia, mercado, contas, luz, internet, transporte, saude, lazer, compras],
    payees: [imob, energia],
    invoices: [],
    purchases: [],
    recurrences: [],
    sources: [],
    incomes: [],
    transfers: [],
    adjustments: [],
    reserveTargetMonths: 6,
  }

  db.recurrences.push(
    { id: uid(), categoryId: moradia.id, description: 'Aluguel', amountCents: 280000, dayOfMonth: 10, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
    { id: uid(), categoryId: moradia.id, description: 'Condomínio', amountCents: 65000, dayOfMonth: 10, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
    { id: uid(), categoryId: saude.id, description: 'Plano de saúde', amountCents: 89000, dayOfMonth: 7, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
    { id: uid(), categoryId: lazer.id, description: 'Streaming', amountCents: 5590, dayOfMonth: 18, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
    { id: uid(), categoryId: internet.id, description: 'Internet', amountCents: 12990, dayOfMonth: 15, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
    { id: uid(), categoryId: transporte.id, description: 'Transporte público', amountCents: 26400, dayOfMonth: 5, startMonth: prev2, endMonth: null, notes: null, responsibleUserId: null },
  )
  const src = (name: string, userId: string, kind: SourceRec['kind'], walletId: string, gross: number, rule: DateRule, deductions: Deduction[]): SourceRec => ({
    id: uid(), userId, kind, walletId, name, amountMode: 'fixed', grossAmountCents: gross, unitPriceCents: null, unitLabel: null,
    dateRule: rule, startMonth: prev2, endMonth: null, notes: null, deductions,
  })
  db.sources.push(
    src('Salário Ana', ana, 'salary', geral.id, 520000, { rule: 'nth_business_day', n: 5 }, DED(57000, 31500)),
    src('Salário Beto', beto, 'salary', geral.id, 380000, { rule: 'last_business_day' }, DED(38600, 7800)),
    src('Vale-refeição Ana', ana, 'benefit', vr.id, 90000, { rule: 'day_of_month', n: 1, weekendAdjust: 'forward' }, []),
  )
  ensureHorizon()

  // Contas variáveis e avulsas
  const one = (categoryId: string, description: string, amountCents: number, dueDate: string, payeeId: string | null = null) =>
    db.invoices.push({ id: uid(), categoryId, description, amountCents, dueDate, competenceMonth: `${dueDate.slice(0, 8)}01`, paid: null, boleto: null, notes: null, payeeId, responsibleUserId: null })
  ;[[prev2, 21345], [prev, 19870], [M, 23410]].forEach(([m, v]) => one(luz.id, 'Conta de luz', v as number, dayIn(m as string, 20), energia.id))
  ;[[prev2, 61230], [prev, 58790], [M, 42150]].forEach(([m, v]) => one(mercado.id, 'Mercado do mês', v as number, dayIn(m as string, 8)))
  one(saude.id, 'Farmácia', 8790, dayIn(prev, 12))
  one(lazer.id, 'Cinema', 9600, dayIn(prev, 22))
  one(lazer.id, 'Jantar fora', 18500, dayIn(M, 25))
  one(saude.id, 'Consulta', 25000, dayIn(M, Math.max(2, Number(today().slice(8, 10)) - 3))) // pode ficar atrasada

  const geladeira: PurchaseRec = { id: uid(), categoryId: compras.id, description: 'Geladeira', purchaseDate: dayIn(prev, 3), totalAmountCents: 389000, installmentsCount: 6, notes: null }
  db.purchases.push(geladeira)
  createInstallments(geladeira, dayIn(prev, 15))
  db.invoices.filter((i) => i.payeeId === null && i.recurrenceId && i.description === 'Aluguel').forEach((i) => (i.payeeId = imob.id))

  // Tudo dos meses passados está pago; no mês atual, o que já venceu (menos a consulta, para mostrar uma atrasada)
  for (const inv of db.invoices) {
    const past = inv.competenceMonth < M
    const dueNow = inv.competenceMonth === M && inv.dueDate < today() && inv.description !== 'Consulta'
    if (past || dueNow) inv.paid = { paidAt: inv.dueDate, walletId: pendingWalletOf(inv), amountCents: inv.amountCents, paidByUserId: ana }
  }

  const transfer = (from: string, to: string, cents: number, month: string, day: number, notes: string | null = null) =>
    db.transfers.push({ id: uid(), fromWalletId: from, toWalletId: to, amountCents: cents, transferDate: dayIn(month, day), competenceMonth: month, notes })
  transfer(geral.id, reserva.id, 50000, prev, 10, 'Guardar para a reserva')
  transfer(geral.id, cdb.id, 30000, M, 6, 'Aporte do mês')
  db.adjustments.push({ id: uid(), walletId: cdb.id, competenceMonth: prev, amountCents: 16400, notes: 'Rendimento', createdAt: now })
}

reset()
