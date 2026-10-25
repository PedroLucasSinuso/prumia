// Rotas da API falsa da demonstração. Cobre o que as telas usam; o que só faz sentido com servidor (convites, senha,
// leitura de documentos) responde `demo_unavailable` e a tela explica.
import { addMonths } from '../lib/dates'
import type {
  Category, CategoryHistory, DateRule, Deduction, IncomeInput, IncomePatch, IncomeSourceInput, IncomeSourcePatch,
  InvoiceInput, InvoicePatch, Me, MonthlySummary, Payee, Purchase, PurchaseInput, Recurrence, RecurrenceInput, TaxEstimate,
  WalletBalance,
} from '../api/types'
import { businessDays, expectedDate } from './calendar'
import {
  balanceOf, createInstallments, dayIn, db, ensureHorizon, generatedThrough, incomeFromSource, isReceived, regenerate,
  reset, statusOf, thisMonth, toIncome, toInvoice, today, walletBalance,
  type IncomeRec, type InvoiceRec, type RecurrenceRec, type SourceRec,
} from './db'
import { empty, invalid, json, notFound, on, problem } from './http'

const uid = () => crypto.randomUUID()
const H = '/households/{householdId}'
const live = <T extends { deletedAt?: string }>(xs: T[]) => xs.filter((x) => !x.deletedAt)
const monthOfDate = (iso: string) => `${iso.slice(0, 8)}01`
const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id)

// ---------- conta e casa ----------

function me(): Me {
  return { ...db.me, theme: db.me.theme as Me['theme'], isSystemOwner: false, households: [{ id: db.house.id, name: db.house.name, role: 'admin' }] }
}
on('GET', '/auth/me', () => json(me()))
on('PATCH', '/auth/me', ({ body }) => {
  const b = body as { name?: string; theme?: string }
  if (b.name !== undefined) db.me.name = b.name.trim() || db.me.name
  if (b.theme) db.me.theme = b.theme
  return json(me())
})
// Sair recomeça a demonstração do zero (não há login de verdade).
on('POST', '/auth/logout', () => { reset(); return empty() })
on('GET', '/auth/signup-invites', () => json([]))
on('GET', `${H}`, () => json(db.house))
on('PATCH', `${H}`, ({ body }) => {
  const name = (body as { name?: string }).name?.trim()
  if (!name) return invalid({ name: 'informe um nome' })
  db.house.name = name
  return json(db.house)
})
on('GET', `${H}/members`, () => json(db.members))
on('PATCH', `${H}/members/{userId}`, ({ params, body }) => {
  const m = db.members.find((x) => x.userId === params.userId)
  if (!m) return notFound()
  const role = (body as { role?: string }).role
  if (m.userId === db.me.id) return problem(409, 'last_admin')
  if (role === 'admin' || role === 'member' || role === 'viewer') m.role = role
  return json(m)
})
on('GET', '/cnpj/{cnpj}', () => problem(503, 'lookup_unavailable'))
on('GET', '/rates', () =>
  json({
    available: true, fetchedAt: new Date().toISOString(),
    rates: [{ code: 'cdi', name: 'CDI', basisPoints: 1490 }, { code: 'selic', name: 'Selic', basisPoints: 1500 }, { code: 'ipca', name: 'IPCA', basisPoints: 517 }],
  }),
)

// ---------- categorias e favorecidos ----------

on('GET', `${H}/categories`, ({ query }) => json(db.categories.filter((c) => query.get('includeArchived') === 'true' || !c.archived)))
on('POST', `${H}/categories`, ({ body }) => {
  const b = body as Partial<Category>
  const name = b.name?.trim()
  if (!name) return invalid({ name: 'informe um nome' })
  if (db.categories.some((c) => !c.archived && c.name.toLowerCase() === name.toLowerCase())) return problem(409, 'category_exists')
  const c: Category = { id: uid(), name, isEssential: Boolean(b.isEssential), sortOrder: db.categories.length, archived: false, defaultWalletId: b.defaultWalletId ?? null, parentId: b.parentId ?? null }
  db.categories.push(c)
  return json(c, 201)
})
on('PATCH', `${H}/categories/{categoryId}`, ({ params, body }) => {
  const c = byId(db.categories, params.categoryId)
  if (!c) return notFound()
  Object.assign(c, body as Partial<Category>)
  return json(c)
})
on('DELETE', `${H}/categories/{categoryId}`, ({ params }) => {
  if (live(db.invoices).some((i) => i.categoryId === params.categoryId)) return problem(409, 'category_in_use')
  db.categories = db.categories.filter((c) => c.id !== params.categoryId)
  return empty()
})
on('GET', `${H}/payees`, ({ query }) => json(db.payees.filter((p) => query.get('includeArchived') === 'true' || !p.archived)))
on('POST', `${H}/payees`, ({ body }) => {
  const b = body as Partial<Payee>
  const name = b.name?.trim()
  if (!name) return invalid({ name: 'informe um nome' })
  if (db.payees.some((p) => p.name.toLowerCase() === name.toLowerCase())) return problem(409, 'payee_exists')
  const p: Payee = { id: uid(), name, cnpj: b.cnpj ?? null, legalName: b.legalName ?? null, defaultCategoryId: b.defaultCategoryId ?? null, archived: false }
  db.payees.push(p)
  return json(p, 201)
})
on('PATCH', `${H}/payees/{payeeId}`, ({ params, body }) => {
  const p = byId(db.payees, params.payeeId)
  if (!p) return notFound()
  Object.assign(p, body as Partial<Payee>)
  return json(p)
})
on('DELETE', `${H}/payees/{payeeId}`, ({ params }) => {
  if (live(db.invoices).some((i) => i.payeeId === params.payeeId)) return problem(409, 'payee_in_use')
  db.payees = db.payees.filter((p) => p.id !== params.payeeId)
  return empty()
})

// ---------- carteiras, transferências, ajustes, reserva ----------

const walletOut = ({ countsAsReserve: _r, ...w }: (typeof db.wallets)[number]) => w
on('GET', `${H}/wallets`, ({ query }) =>
  json(db.wallets.filter((w) => query.get('includeArchived') === 'true' || !w.archived).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder).map(walletOut)),
)
on('POST', `${H}/wallets`, ({ body }) => {
  const b = body as Record<string, unknown>
  const name = String(b.name ?? '').trim()
  if (!name) return invalid({ name: 'informe um nome de 1 a 40 caracteres' })
  if (db.wallets.some((w) => !w.archived && w.name.toLowerCase() === name.toLowerCase())) return problem(409, 'wallet_exists')
  const kind = (b.kind as string) ?? 'regular'
  if (kind !== 'regular' && kind !== 'investment') return invalid({ kind: 'tipo de carteira inválido' })
  const w = {
    id: uid(), name, kind: kind as 'regular' | 'investment', institution: (b.institution as string)?.trim() || null, ownerUserId: (b.ownerUserId as string) ?? null,
    isDefault: false, warnOnOverdraft: b.warnOnOverdraft !== false, openingBalanceCents: Number(b.openingBalanceCents ?? 0),
    openingBalanceMonth: (b.openingBalanceMonth as string) ?? null, sortOrder: db.wallets.length, archived: false,
  }
  db.wallets.push(w)
  return json(w, 201)
})
on('PATCH', `${H}/wallets/{walletId}`, ({ params, body }) => {
  const w = byId(db.wallets, params.walletId)
  if (!w) return notFound()
  const b = body as Record<string, unknown>
  if (b.isDefault === true) {
    if (w.kind === 'investment') return invalid({ isDefault: 'carteira de investimento não pode ser a padrão' })
    db.wallets.forEach((x) => (x.isDefault = false))
    w.isDefault = true
  }
  for (const k of ['name', 'ownerUserId', 'warnOnOverdraft', 'openingBalanceCents', 'openingBalanceMonth', 'sortOrder', 'institution'] as const) {
    if (k in b) (w as Record<string, unknown>)[k] = b[k]
  }
  return json(walletOut(w))
})
on('POST', `${H}/wallets/{walletId}/archive`, ({ params }) => {
  const w = byId(db.wallets, params.walletId)
  if (!w) return notFound()
  if (w.isDefault) return problem(409, 'wallet_is_default')
  w.archived = true
  return json(walletOut(w))
})
on('POST', `${H}/wallets/{walletId}/restore`, ({ params }) => {
  const w = byId(db.wallets, params.walletId)
  if (!w) return notFound()
  w.archived = false
  return json(walletOut(w))
})

/** Aviso de saldo: a carteira tem o aviso ligado e o saldo realizado do mês ficou negativo. */
function overdraft(walletId: string, month: string) {
  const w = byId(db.wallets, walletId)
  if (!w || !w.warnOnOverdraft) return { warnings: [], warningDetails: [] }
  return balanceOf(walletBalance(w, month)) < 0
    ? { warnings: ['wallet_balance_insufficient'], warningDetails: [{ code: 'wallet_balance_insufficient', walletId }] }
    : { warnings: [], warningDetails: [] }
}

const out = <T extends { deletedAt?: string }>({ deletedAt: _d, ...x }: T) => x
on('GET', `${H}/transfers`, ({ query }) => json(live(db.transfers).filter((t) => t.competenceMonth === query.get('month')).map(out)))
on('POST', `${H}/transfers`, ({ body }) => {
  const b = body as Record<string, unknown>
  const from = byId(db.wallets, String(b.fromWalletId))
  const to = byId(db.wallets, String(b.toWalletId))
  const cents = Number(b.amountCents)
  if (!from || from.archived) return invalid({ fromWalletId: 'carteira inválida' })
  if (!to || to.archived || to.id === from.id) return invalid({ toWalletId: 'escolha outra carteira' })
  if (!(cents > 0)) return invalid({ amountCents: 'informe um valor maior que zero' })
  const date = (b.transferDate as string) ?? today()
  const t = { id: uid(), fromWalletId: from.id, toWalletId: to.id, amountCents: cents, transferDate: date, competenceMonth: (b.competenceMonth as string) ?? monthOfDate(date), notes: (b.notes as string) ?? null }
  db.transfers.push(t)
  return json({ transfer: t, ...overdraft(from.id, t.competenceMonth) }, 201)
})
on('DELETE', `${H}/transfers/{transferId}`, ({ params }) => {
  const t = byId(live(db.transfers), params.transferId)
  if (!t) return notFound()
  t.deletedAt = today()
  return empty()
})
on('POST', `${H}/transfers/{transferId}/restore`, ({ params }) => {
  const t = byId(db.transfers, params.transferId)
  if (!t) return notFound()
  delete t.deletedAt
  return json(out(t))
})

on('GET', `${H}/wallet-adjustments`, ({ query }) => json(live(db.adjustments).filter((a) => a.competenceMonth === query.get('month')).map(out)))
on('POST', `${H}/wallet-adjustments`, ({ body }) => {
  const b = body as Record<string, unknown>
  const w = byId(db.wallets, String(b.walletId))
  if (!w || w.archived) return invalid({ walletId: 'carteira inválida' })
  const month = (b.competenceMonth as string) ?? thisMonth()
  if (month > thisMonth()) return invalid({ competenceMonth: 'só dá para conferir o saldo até o mês atual' })
  const diff = Number(b.actualBalanceCents) - balanceOf(walletBalance(w, month))
  if (diff === 0) return invalid({ actualBalanceCents: 'o saldo já confere: não há diferença para ajustar' })
  const a = { id: uid(), walletId: w.id, competenceMonth: month, amountCents: diff, notes: (b.notes as string) ?? null, createdAt: new Date().toISOString() }
  db.adjustments.push(a)
  return json(a, 201)
})
on('DELETE', `${H}/wallet-adjustments/{adjustmentId}`, ({ params }) => {
  const a = byId(live(db.adjustments), params.adjustmentId)
  if (!a) return notFound()
  a.deletedAt = today()
  return empty()
})
on('POST', `${H}/wallet-adjustments/{adjustmentId}/restore`, ({ params }) => {
  const a = byId(db.adjustments, params.adjustmentId)
  if (!a) return notFound()
  delete a.deletedAt
  return json(out(a))
})

function reserveStatus(month: string) {
  const essential = (inv: InvoiceRec) => {
    const c = byId(db.categories, inv.categoryId)
    const parent = c?.parentId ? byId(db.categories, c.parentId) : undefined
    return Boolean(c?.isEssential || parent?.isEssential)
  }
  const monthsWith = new Set(live(db.invoices).map((i) => i.competenceMonth))
  const totalOf = (m: string) => live(db.invoices).filter((i) => i.competenceMonth === m && essential(i)).reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0)
  const basis: string[] = []
  for (let k = 1; k <= 6; k++) if (monthsWith.has(addMonths(month, -k))) basis.push(addMonths(month, -k))
  const months = basis.length ? basis : [month]
  const essentialMonthlyCents = Math.round(months.reduce((s, m) => s + totalOf(m), 0) / months.length)
  const walletIds = db.wallets.filter((w) => w.countsAsReserve).map((w) => w.id)
  const savedCents = db.wallets.filter((w) => w.countsAsReserve).reduce((s, w) => s + balanceOf(walletBalance(w, month)), 0)
  const target = db.reserveTargetMonths
  return { targetMonths: target, walletIds, essentialMonthlyCents, basisMonths: basis.length, savedCents, targetCents: target ? target * essentialMonthlyCents : 0 }
}
on('GET', `${H}/reserve`, ({ query }) => json(reserveStatus(query.get('month') ?? thisMonth())))
on('PUT', `${H}/reserve`, ({ body }) => {
  const b = body as { targetMonths: number | null; walletIds: string[] }
  if (b.targetMonths !== null && (b.targetMonths < 1 || b.targetMonths > 36)) return invalid({ targetMonths: 'de 1 a 36 meses' })
  db.reserveTargetMonths = b.targetMonths
  db.wallets.forEach((w) => (w.countsAsReserve = b.walletIds.includes(w.id)))
  return json(reserveStatus(thisMonth()))
})

// ---------- contas (invoices), compras e contas fixas ----------

function checkInvoice(b: Partial<InvoiceInput>) {
  const f: Record<string, string> = {}
  if (!b.categoryId || !byId(db.categories, b.categoryId)) f.categoryId = 'escolha uma categoria'
  if (!b.description?.trim()) f.description = 'informe uma descrição'
  if (!(Number(b.amountCents) > 0)) f.amountCents = 'informe um valor maior que zero'
  if (!b.dueDate) f.dueDate = 'informe o vencimento'
  return Object.keys(f).length ? f : null
}

function newInvoice(b: InvoiceInput): InvoiceRec {
  let payeeId = b.payeeId ?? null
  if (b.newPayee?.name) {
    const p: Payee = { id: uid(), name: b.newPayee.name, cnpj: b.newPayee.cnpj ?? null, legalName: b.newPayee.legalName ?? null, defaultCategoryId: b.categoryId, archived: false }
    db.payees.push(p)
    payeeId = p.id
  }
  return {
    id: uid(), categoryId: b.categoryId, responsibleUserId: b.responsibleUserId ?? null, payeeId, description: b.description.trim(),
    amountCents: b.amountCents, dueDate: b.dueDate, competenceMonth: b.competenceMonth ?? monthOfDate(b.dueDate), paid: null,
    boleto: b.boleto ?? null, notes: b.notes ?? null,
  }
}

on('GET', `${H}/invoices`, ({ query }) => {
  const month = query.get('month')
  if (month) ensureHorizon(month)
  const q = query.get('q')?.toLowerCase()
  const items = live(db.invoices)
    .filter((i) => (!month || i.competenceMonth === month) && (!q || i.description.toLowerCase().includes(q)))
    .filter((i) => !query.get('status') || statusOf(i) === query.get('status'))
    .filter((i) => !query.get('categoryId') || i.categoryId === query.get('categoryId'))
    .filter((i) => !query.get('purchaseId') || i.purchaseId === query.get('purchaseId'))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description))
  return json({ items: items.map(toInvoice), nextCursor: null })
})
on('POST', `${H}/invoices`, ({ body }) => {
  const b = body as InvoiceInput
  const f = checkInvoice(b)
  if (f) return invalid(f)
  const inv = newInvoice(b)
  db.invoices.push(inv)
  return json(toInvoice(inv), 201)
})
on('POST', `${H}/invoices/batch`, ({ body }) => {
  const items = (body as { items: InvoiceInput[] }).items ?? []
  for (const [k, b] of items.entries()) {
    const f = checkInvoice(b)
    if (f) return invalid(Object.fromEntries(Object.entries(f).map(([key, v]) => [`items[${k}].${key}`, v])))
  }
  const created = items.map((b) => { const inv = newInvoice(b); db.invoices.push(inv); return toInvoice(inv) })
  return json({ items: created }, 201)
})
on('GET', `${H}/invoices/{invoiceId}`, ({ params }) => {
  const inv = byId(live(db.invoices), params.invoiceId)
  return inv ? json(toInvoice(inv)) : notFound()
})

/** Alcance de uma ação em série: só esta, ou esta e as seguintes ainda não pagas da mesma série. */
function scopeOf(inv: InvoiceRec, scope: string | null, includeDeleted = false) {
  if (scope !== 'following' || (!inv.purchaseId && !inv.recurrenceId)) return [inv]
  return (includeDeleted ? db.invoices : live(db.invoices)).filter(
    (i) => (i.id === inv.id || !i.paid) && (inv.purchaseId ? i.purchaseId === inv.purchaseId && (i.installmentNumber ?? 0) >= (inv.installmentNumber ?? 0) : i.recurrenceId === inv.recurrenceId && i.competenceMonth >= inv.competenceMonth),
  )
}

on('PATCH', `${H}/invoices/{invoiceId}`, ({ params, query, body }) => {
  const inv = byId(live(db.invoices), params.invoiceId)
  if (!inv) return notFound()
  const b = body as InvoicePatch
  const targets = scopeOf(inv, query.get('scope'))
  if (targets.length > 1 && (b.dueDate || b.competenceMonth)) return invalid({ dueDate: 'em lote, o vencimento não muda' })
  for (const t of targets) {
    if (b.categoryId) t.categoryId = b.categoryId
    if (b.amountCents) t.amountCents = b.amountCents
    if ('payeeId' in b) t.payeeId = b.payeeId ?? null
    if ('notes' in b) t.notes = b.notes ?? null
    if ('responsibleUserId' in b) t.responsibleUserId = b.responsibleUserId ?? null
    if (b.description) t.description = targets.length > 1 && t.installmentNumber ? `${b.description} (${t.installmentNumber}/${t.installmentsCount})` : b.description
    if (b.dueDate) { t.dueDate = b.dueDate; t.competenceMonth = b.competenceMonth ?? monthOfDate(b.dueDate) }
    else if (b.competenceMonth) t.competenceMonth = b.competenceMonth
  }
  if (inv.recurrenceId && targets.length > 1) {
    const r = byId(db.recurrences, inv.recurrenceId)
    if (r) { if (b.amountCents) r.amountCents = b.amountCents; if (b.description) r.description = b.description; if (b.categoryId) r.categoryId = b.categoryId }
  }
  return json(toInvoice(inv))
})
on('DELETE', `${H}/invoices/{invoiceId}`, ({ params, query }) => {
  const inv = byId(live(db.invoices), params.invoiceId)
  if (!inv) return notFound()
  const stamp = new Date().toISOString()
  scopeOf(inv, query.get('scope')).forEach((t) => (t.deletedAt = stamp))
  if (inv.recurrenceId && query.get('scope') === 'following') {
    const r = byId(db.recurrences, inv.recurrenceId)
    if (r) { if (inv.competenceMonth <= r.startMonth) r.deletedAt = stamp; else r.endMonth = addMonths(inv.competenceMonth, -1) }
  }
  return empty()
})
on('POST', `${H}/invoices/{invoiceId}/restore`, ({ params, query }) => {
  const inv = byId(db.invoices, params.invoiceId)
  if (!inv) return notFound()
  const targets = query.get('scope') === 'following' ? scopeOf(inv, 'following', true).filter((t) => t.deletedAt === inv.deletedAt) : [inv]
  targets.forEach((t) => delete t.deletedAt)
  if (inv.recurrenceId) {
    const r = byId(db.recurrences, inv.recurrenceId)
    if (r) { delete r.deletedAt; if (query.get('scope') === 'following') r.endMonth = null }
  }
  return json(toInvoice(inv))
})
on('POST', `${H}/invoices/{invoiceId}/pay`, ({ params, body }) => {
  const inv = byId(live(db.invoices), params.invoiceId)
  if (!inv) return notFound()
  if (inv.paid) return problem(409, 'already_paid')
  const b = body as { walletId: string; paidAt?: string; amountCents?: number }
  const w = byId(db.wallets, b.walletId)
  if (!w || w.archived) return invalid({ walletId: 'carteira inválida' })
  if (w.kind === 'investment') return invalid({ walletId: 'carteira de investimento não paga conta nem recebe receita: use uma transferência' })
  inv.paid = { paidAt: b.paidAt ?? today(), walletId: w.id, amountCents: b.amountCents ?? inv.amountCents, paidByUserId: db.me.id }
  return json({ invoice: toInvoice(inv), ...overdraft(w.id, inv.competenceMonth) })
})
on('DELETE', `${H}/invoices/{invoiceId}/pay`, ({ params }) => {
  const inv = byId(live(db.invoices), params.invoiceId)
  if (!inv) return notFound()
  inv.paid = null
  return json(toInvoice(inv))
})

function toPurchase(p: (typeof db.purchases)[number]): Purchase {
  return { ...p, installments: live(db.invoices).filter((i) => i.purchaseId === p.id).sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0)).map(toInvoice) }
}
on('GET', `${H}/purchases`, ({ query }) => {
  const q = query.get('q')?.toLowerCase()
  const items = db.purchases.filter((p) => (!q || p.description.toLowerCase().includes(q)) && live(db.invoices).some((i) => i.purchaseId === p.id))
  return json({ items: items.map(toPurchase), nextCursor: null })
})
on('GET', `${H}/purchases/{purchaseId}`, ({ params }) => {
  const p = byId(db.purchases, params.purchaseId)
  return p && live(db.invoices).some((i) => i.purchaseId === p.id) ? json(toPurchase(p)) : notFound()
})
on('POST', `${H}/purchases`, ({ body }) => {
  const b = body as PurchaseInput
  const f: Record<string, string> = {}
  if (!b.categoryId) f.categoryId = 'escolha uma categoria'
  if (!b.description?.trim()) f.description = 'informe uma descrição'
  if (!(b.totalAmountCents > 0)) f.totalAmountCents = 'informe o valor'
  if (!(b.installmentsCount >= 2 && b.installmentsCount <= 120)) f.installmentsCount = 'de 2 a 120 parcelas'
  if (Object.keys(f).length) return invalid(f)
  const p = { id: uid(), categoryId: b.categoryId, responsibleUserId: b.responsibleUserId ?? null, description: b.description.trim(), purchaseDate: b.purchaseDate, totalAmountCents: b.totalAmountCents, installmentsCount: b.installmentsCount, notes: b.notes ?? null }
  db.purchases.push(p)
  createInstallments(p, b.firstDueDate, b.installmentAmountCents)
  return json(toPurchase(p), 201)
})

const toRecurrence = ({ deletedAt: _d, ...r }: RecurrenceRec): Recurrence => ({ ...r, generatedThrough: generatedThrough() })
on('GET', `${H}/recurrences`, () => json(live(db.recurrences).map(toRecurrence)))
on('POST', `${H}/recurrences`, ({ body }) => {
  const b = body as RecurrenceInput
  if (!b.description?.trim() || !(b.amountCents > 0)) return invalid({ description: 'informe descrição e valor' })
  const r: RecurrenceRec = { id: uid(), categoryId: b.categoryId, responsibleUserId: b.responsibleUserId ?? null, description: b.description.trim(), amountCents: b.amountCents, dayOfMonth: b.dayOfMonth, startMonth: b.startMonth, endMonth: b.endMonth ?? null, notes: b.notes ?? null }
  db.recurrences.push(r)
  regenerate()
  return json(toRecurrence(r), 201)
})
on('PATCH', `${H}/recurrences/{recurrenceId}`, ({ params, body }) => {
  const r = byId(live(db.recurrences), params.recurrenceId)
  if (!r) return notFound()
  const b = body as Partial<RecurrenceInput>
  if (b.endMonth && r.endMonth && b.endMonth > r.endMonth) return invalid({ endMonth: 'não dá para adiar o fim' })
  Object.assign(r, b)
  // Vale para as ocorrências futuras ainda não pagas
  for (const i of live(db.invoices).filter((x) => x.recurrenceId === r.id && !x.paid && x.competenceMonth >= thisMonth())) {
    if (b.endMonth && i.competenceMonth > b.endMonth) { i.deletedAt = new Date().toISOString(); continue }
    i.amountCents = r.amountCents
    i.description = r.description
    i.categoryId = r.categoryId
    if (b.dayOfMonth) i.dueDate = dayIn(i.competenceMonth, b.dayOfMonth)
  }
  return json(toRecurrence(r))
})

// ---------- receitas e fontes ----------

function grossOf(b: Partial<IncomeInput>) {
  return b.amountMode === 'per_unit' ? Number(b.unitPriceCents ?? 0) * Number(b.quantity ?? businessDays(b.competenceMonth ?? thisMonth()).length) : Number(b.grossAmountCents ?? 0)
}
function checkDeductions(gross: number, ded: Deduction[] | undefined) {
  return (ded ?? []).reduce((s, d) => s + d.amountCents, 0) > gross ? { deductions: 'os descontos passam do valor bruto' } : null
}
function defaultWallet(kind: string) {
  const vr = db.wallets.find((w) => !w.archived && w.kind === 'regular' && w.name.toLowerCase() === 'benefício')
  return kind === 'benefit' && vr ? vr.id : db.wallets.find((w) => w.isDefault)!.id
}
function checkIncomeWallet(id: string | undefined) {
  if (!id) return null
  const w = byId(db.wallets, id)
  if (!w || w.archived) return { walletId: 'carteira inválida' }
  if (w.kind === 'investment') return { walletId: 'carteira de investimento não paga conta nem recebe receita: use uma transferência' }
  return null
}

on('GET', `${H}/incomes`, ({ query }) => {
  const month = query.get('month') ?? thisMonth()
  ensureHorizon(month)
  return json(live(db.incomes).filter((i) => i.competenceMonth === month).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).map(toIncome))
})
on('POST', `${H}/incomes`, ({ body }) => {
  const b = body as IncomeInput
  const gross = grossOf(b)
  const f = { ...(!b.description?.trim() ? { description: 'informe uma descrição' } : {}), ...(gross <= 0 ? { grossAmountCents: 'informe o valor' } : {}), ...checkDeductions(gross, b.deductions), ...checkIncomeWallet(b.walletId) }
  if (Object.keys(f).length) return invalid(f)
  const walletId = b.walletId ?? defaultWallet(b.kind)
  if (b.repeats && b.dateRule) {
    const s: SourceRec = {
      id: uid(), userId: b.userId, kind: b.kind, walletId, name: b.description.trim(), amountMode: b.amountMode ?? 'fixed', grossAmountCents: b.amountMode === 'per_unit' ? Number(b.unitPriceCents) : gross,
      unitPriceCents: b.unitPriceCents ?? null, unitLabel: b.unitLabel ?? null, dateRule: b.dateRule, startMonth: b.competenceMonth, endMonth: b.repeatsUntil ?? null, notes: b.notes ?? null, deductions: b.deductions ?? [],
    }
    db.sources.push(s)
    regenerate()
    const first = db.incomes.find((i) => i.sourceId === s.id && i.competenceMonth === b.competenceMonth)!
    if (b.expectedDate) first.expectedDate = b.expectedDate
    return json(toIncome(first), 201)
  }
  const i: IncomeRec = {
    id: uid(), sourceId: null, userId: b.userId, kind: b.kind, description: b.description.trim(), walletId, competenceMonth: b.competenceMonth,
    expectedDate: b.expectedDate ?? (b.dateRule ? expectedDate(b.dateRule, b.competenceMonth) : b.competenceMonth), amountMode: b.amountMode ?? 'fixed',
    grossAmountCents: gross, unitPriceCents: b.unitPriceCents ?? null, quantity: b.quantity ?? null, unitLabel: b.unitLabel ?? null, dateRule: b.dateRule ?? null,
    deductions: b.deductions ?? [], held: false, notes: b.notes ?? null,
  }
  db.incomes.push(i)
  return json(toIncome(i), 201)
})

function applyIncomePatch(i: IncomeRec, b: IncomePatch) {
  for (const k of ['userId', 'kind', 'walletId', 'description', 'expectedDate', 'amountMode', 'unitPriceCents', 'quantity', 'unitLabel', 'notes', 'competenceMonth'] as const) {
    if (k in b) (i as Record<string, unknown>)[k] = b[k]
  }
  if (b.deductions) i.deductions = b.deductions
  if (b.dateRule) { i.dateRule = b.dateRule; if (!('expectedDate' in b)) i.expectedDate = expectedDate(b.dateRule, i.competenceMonth) }
  if ('grossAmountCents' in b || 'unitPriceCents' in b || 'quantity' in b) i.grossAmountCents = i.amountMode === 'per_unit' ? Number(i.unitPriceCents ?? 0) * Number(i.quantity ?? 0) : Number(b.grossAmountCents ?? i.grossAmountCents)
}
on('PATCH', `${H}/incomes/{incomeId}`, ({ params, query, body }) => {
  const i = byId(live(db.incomes), params.incomeId)
  if (!i) return notFound()
  const b = body as IncomePatch
  const f = { ...checkIncomeWallet(b.walletId), ...checkDeductions(Number(b.grossAmountCents ?? i.grossAmountCents), b.deductions ?? i.deductions) }
  if (Object.keys(f).length) return invalid(f)
  const targets = query.get('scope') === 'following' && i.sourceId
    ? live(db.incomes).filter((x) => x.sourceId === i.sourceId && x.competenceMonth >= i.competenceMonth && (x.id === i.id || !isReceived(x)))
    : [i]
  for (const t of targets) applyIncomePatch(t, t === i ? b : { ...b, expectedDate: undefined, competenceMonth: undefined })
  if (targets.length > 1) {
    const s = byId(db.sources, i.sourceId!)
    if (s) {
      if (b.grossAmountCents) s.grossAmountCents = b.grossAmountCents
      if (b.deductions) s.deductions = b.deductions
      if (b.dateRule) s.dateRule = b.dateRule
      if (b.walletId) s.walletId = b.walletId
      if (b.description) s.name = b.description
    }
    targets.forEach((t) => { if (t !== i && !('expectedDate' in b) && t.dateRule) t.expectedDate = expectedDate(t.dateRule, t.competenceMonth) })
  }
  return json(toIncome(i))
})
on('DELETE', `${H}/incomes/{incomeId}`, ({ params, query }) => {
  const i = byId(live(db.incomes), params.incomeId)
  if (!i) return notFound()
  const stamp = new Date().toISOString()
  if (query.get('scope') === 'following' && i.sourceId) {
    live(db.incomes).filter((x) => x.sourceId === i.sourceId && x.competenceMonth >= i.competenceMonth).forEach((x) => (x.deletedAt = stamp))
    const s = byId(db.sources, i.sourceId)
    if (s) s.endMonth = addMonths(i.competenceMonth, -1)
  } else i.deletedAt = stamp
  return empty()
})
on('POST', `${H}/incomes/{incomeId}/restore`, ({ params, query }) => {
  const i = byId(db.incomes, params.incomeId)
  if (!i) return notFound()
  if (query.get('scope') === 'following' && i.sourceId) {
    db.incomes.filter((x) => x.deletedAt === i.deletedAt && x.sourceId === i.sourceId).forEach((x) => delete x.deletedAt)
    const s = byId(db.sources, i.sourceId)
    if (s) s.endMonth = null
  } else delete i.deletedAt
  return json(toIncome(i))
})
on('POST', `${H}/incomes/{incomeId}/receive`, ({ params, body }) => {
  const i = byId(live(db.incomes), params.incomeId)
  if (!i) return notFound()
  if (isReceived(i)) return problem(409, 'already_received')
  i.held = false
  if (i.expectedDate > today()) i.receivedEarly = (body as { receivedAt?: string } | undefined)?.receivedAt ?? today()
  return json(toIncome(i))
})
on('DELETE', `${H}/incomes/{incomeId}/receive`, ({ params }) => {
  const i = byId(live(db.incomes), params.incomeId)
  if (!i) return notFound()
  if (!isReceived(i)) return problem(409, 'not_received')
  delete i.receivedEarly
  if (i.expectedDate <= today()) i.held = true
  return json(toIncome(i))
})

const toSource = ({ deletedAt: _d, ...s }: SourceRec) => ({ ...s, dayOfMonth: s.dateRule.rule === 'day_of_month' ? (s.dateRule.n ?? 1) : 1, generatedThrough: generatedThrough() })
on('GET', `${H}/income-sources`, () => json(live(db.sources).map(toSource)))
on('POST', `${H}/income-sources`, ({ body }) => {
  const b = body as IncomeSourceInput
  const rule: DateRule = b.dateRule ?? { rule: 'day_of_month', n: b.dayOfMonth ?? 1 }
  const f = { ...(!b.name?.trim() ? { name: 'informe um nome' } : {}), ...checkIncomeWallet(b.walletId), ...(db.members.some((m) => m.userId === b.userId) ? {} : { userId: 'escolha alguém da casa' }) }
  if (Object.keys(f).length) return invalid(f)
  const s: SourceRec = {
    id: uid(), userId: b.userId, kind: b.kind, walletId: b.walletId ?? defaultWallet(b.kind), name: b.name.trim(), amountMode: b.amountMode ?? 'fixed',
    grossAmountCents: Number(b.grossAmountCents ?? b.unitPriceCents ?? 0), unitPriceCents: b.unitPriceCents ?? null, unitLabel: b.unitLabel ?? null,
    dateRule: rule, startMonth: b.startMonth, endMonth: b.endMonth ?? null, notes: b.notes ?? null, deductions: b.deductions ?? [],
  }
  db.sources.push(s)
  regenerate()
  return json(toSource(s), 201)
})
on('PATCH', `${H}/income-sources/{sourceId}`, ({ params, query, body }) => {
  const s = byId(live(db.sources), params.sourceId)
  if (!s) return notFound()
  const b = body as IncomeSourcePatch
  if (b.endMonth && s.endMonth && b.endMonth > s.endMonth) return invalid({ endMonth: 'não dá para adiar o fim' })
  for (const k of ['userId', 'kind', 'walletId', 'name', 'notes', 'amountMode', 'grossAmountCents', 'unitPriceCents', 'unitLabel', 'dateRule', 'endMonth', 'deductions'] as const) {
    if (k in b) (s as Record<string, unknown>)[k] = b[k]
  }
  if (b.dayOfMonth) s.dateRule = { ...s.dateRule, rule: 'day_of_month', n: b.dayOfMonth }
  const from = query.get('applyFrom')
  // Reaplica o molde dos meses `applyFrom` em diante (os que ainda não contam como recebidos); o fim apaga os de depois.
  for (const i of live(db.incomes).filter((x) => x.sourceId === s.id)) {
    if (s.endMonth && i.competenceMonth > s.endMonth) { i.deletedAt = new Date().toISOString(); continue }
    if (from && i.competenceMonth >= from && !isReceived(i)) Object.assign(i, { ...incomeFromSource(s, i.competenceMonth), id: i.id })
  }
  return json(toSource(s))
})
on('DELETE', `${H}/income-sources/{sourceId}`, ({ params }) => {
  const s = byId(live(db.sources), params.sourceId)
  if (!s) return notFound()
  s.deletedAt = new Date().toISOString()
  live(db.incomes).filter((i) => i.sourceId === s.id && i.competenceMonth >= thisMonth() && !isReceived(i)).forEach((i) => (i.deletedAt = s.deletedAt))
  return empty()
})
on('POST', `${H}/income-sources/{sourceId}/restore`, ({ params }) => {
  const s = byId(db.sources, params.sourceId)
  if (!s) return notFound()
  db.incomes.filter((i) => i.sourceId === s.id && i.deletedAt === s.deletedAt).forEach((i) => delete i.deletedAt)
  delete s.deletedAt
  return json(toSource(s))
})
on('GET', `${H}/income-dates`, ({ query }) => {
  const month = query.get('month') ?? thisMonth()
  const rule: DateRule = {
    rule: (query.get('rule') ?? 'day_of_month') as DateRule['rule'], n: query.get('n') ? Number(query.get('n')) : null,
    weekendAdjust: (query.get('weekendAdjust') ?? 'forward') as DateRule['weekendAdjust'], monthOffset: Number(query.get('monthOffset') ?? 0) as DateRule['monthOffset'],
  }
  const count = Number(query.get('count') ?? 3)
  return json(Array.from({ length: count }, (_, k) => { const m = addMonths(month, k); return { month: m, expectedDate: expectedDate(rule, m), businessDays: businessDays(m).length } }))
})
on('GET', `${H}/tax/estimate`, ({ query }) => {
  // Estimativa simplificada (tabelas de 2026 aproximadas; o servidor de verdade usa internal/tax)
  const gross = Number(query.get('grossCents') ?? 0)
  const bands: [number, number][] = [[162100, 0.075], [290250, 0.09], [435375, 0.12], [847555, 0.14]]
  let inss = 0, prev = 0
  for (const [top, rate] of bands) { if (gross > prev) inss += (Math.min(gross, top) - prev) * rate; prev = top }
  const base = gross - inss
  const irrf = base <= 500000 ? 0 : Math.max(0, base * 0.275 - 90800)
  const est: TaxEstimate = { inssCents: Math.round(inss), irrfCents: Math.round(irrf), tableYear: Number(thisMonth().slice(0, 4)), sources: [], checkedOn: thisMonth(), approximate: true }
  return json(est)
})

// ---------- resumo ----------

function summary(month: string): MonthlySummary {
  ensureHorizon(month)
  const wallets: WalletBalance[] = []
  const ordered = [...db.wallets].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder)
  for (const w of ordered) {
    const b = walletBalance(w, month)
    const moved = b.expected || b.received || b.paid || b.pending || b.transfersIn || b.transfersOut || b.adjustments
    if (w.archived && !b.carryOver && !moved) continue
    const monthBalance = b.received - b.paid + b.transfersIn - b.transfersOut + b.adjustments
    wallets.push({
      walletId: w.id, name: w.name, kind: w.kind, ownerUserId: w.ownerUserId ?? null, isDefault: w.isDefault, archived: w.archived,
      openingBalanceCents: w.openingBalanceCents, openingBalanceMonth: w.openingBalanceMonth ?? null, carryOverCents: b.carryOver,
      expectedIncomeCents: b.expected, receivedIncomeCents: b.received, paidCents: b.paid, transfersInCents: b.transfersIn,
      transfersOutCents: b.transfersOut, adjustmentsCents: b.adjustments, balanceCents: b.carryOver + monthBalance, monthBalanceCents: monthBalance,
      pendingCents: b.pending, projectedCents: b.carryOver + b.expected - b.paid - b.pending + b.transfersIn - b.transfersOut + b.adjustments,
    })
  }
  const invs = live(db.invoices).filter((i) => i.competenceMonth === month)
  const byCat = new Map<string, { total: number; paid: number }>()
  for (const i of invs) {
    const c = byCat.get(i.categoryId) ?? { total: 0, paid: 0 }
    c.total += i.paid?.amountCents ?? i.amountCents
    c.paid += i.paid?.amountCents ?? 0
    byCat.set(i.categoryId, c)
  }
  const overdue = invs.filter((i) => statusOf(i) === 'overdue')
  return {
    month, wallets,
    totalPaidCents: invs.reduce((s, i) => s + (i.paid?.amountCents ?? 0), 0),
    totalPendingCents: invs.filter((i) => !i.paid).reduce((s, i) => s + i.amountCents, 0),
    overdueCents: overdue.reduce((s, i) => s + i.amountCents, 0), overdueCount: overdue.length,
    byCategory: [...byCat].map(([categoryId, c]) => ({ categoryId, totalCents: c.total, paidCents: c.paid })).sort((a, b) => b.totalCents - a.totalCents),
  }
}
on('GET', `${H}/summary`, ({ query }) => json(summary(query.get('month') ?? thisMonth())))
on('GET', `${H}/summary/categories`, ({ query }) => {
  const to = query.get('to') ?? thisMonth()
  const from = query.get('from') ?? addMonths(to, -5)
  ensureHorizon(to)
  const months: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m)
  const invs = live(db.invoices).filter((i) => i.competenceMonth >= from && i.competenceMonth <= to)
  const cats = [...new Set(invs.map((i) => i.categoryId))]
  const series = cats.map((categoryId) => ({
    categoryId,
    points: months.map((month) => {
      const xs = invs.filter((i) => i.categoryId === categoryId && i.competenceMonth === month)
      const total = xs.reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0)
      return { month, totalCents: total, paidCents: xs.reduce((s, i) => s + (i.paid?.amountCents ?? 0), 0), seriesCents: xs.filter((i) => i.purchaseId || i.recurrenceId).reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0) }
    }),
  })).sort((a, b) => b.points.reduce((s, p) => s + p.totalCents, 0) - a.points.reduce((s, p) => s + p.totalCents, 0))
  const out: CategoryHistory = { months, series }
  return json(out)
})
on('GET', `${H}/export/invoices.csv`, () => {
  const rows = live(db.invoices).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((i) => {
    const cat = byId(db.categories, i.categoryId)?.name ?? ''
    return [i.dueDate, i.competenceMonth.slice(0, 7), `"${i.description.replace(/"/g, '""')}"`, cat, (i.amountCents / 100).toFixed(2).replace('.', ','), i.paid ? 'paga' : statusOf(i) === 'overdue' ? 'atrasada' : 'pendente'].join(';')
  })
  return new Response(['vencimento;competencia;descricao;categoria;valor;situacao', ...rows].join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
})

// O resto (convites, senha, leitura de boleto/documento, criar casa) responde demo_unavailable pelo próprio roteador.
