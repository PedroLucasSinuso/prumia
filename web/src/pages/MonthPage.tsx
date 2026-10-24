import { FileUp, Layers, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { getInvoice, useCategories, useCategoryActions, extractDocument, useInvoiceActions, useInvoices, usePayees, usePurchase } from '../api/queries'
import type { Category, Invoice, SeriesScope } from '../api/types'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { Button } from '../components/Button'
import { CategoryBreakdown } from '../components/CategoryBreakdown'
import { InvoiceDetail } from '../components/InvoiceDetail'
import { InvoiceForm } from '../components/InvoiceForm'
import { InvoiceSheet } from '../components/InvoiceSheet'
import { MonthRuler } from '../components/MonthRuler'
import { MonthSections } from '../components/MonthSections'
import { MonthSelector } from '../components/MonthSelector'
import { PaidGauge } from '../components/PaidGauge'
import { Sheet } from '../components/Sheet'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { SlideOver } from '../components/SlideOver'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/toastContext'
import { buildTree, categoryPath, rollup } from '../lib/categories'
import { addMonths, currentMonth, dayMonth, todayISO } from '../lib/dates'
import { dueSoon, filterInvoices, repeatsCategory, sectionsOf, type SectionId, type StatusFilter } from '../lib/monthList'
import { useHasSidePanel } from '../lib/media'
import { formatCents } from '../lib/money'
import { usePref } from '../lib/storage'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'

/** A conta aberta: em leitura (detalhe) ou no formulário (editar). */
type Panel = { id: string; mode: 'view' | 'edit' } | null

const walletLabel = { free: 'carteira livre', benefit: 'carteira de benefício' } as const
const label = 'text-xs font-medium uppercase tracking-wider'
const COLLAPSED_KEY = 'prumia.mes.secoesRecolhidas'

const isTyping = (el: Element | null) => Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
const rowIdOf = (el: Element | null) => (el?.closest('[data-row-id]') as HTMLElement | null)?.dataset.rowId

/**
 * A visão do mês. O mês escolhido fica na URL (?mes=2026-10): voltar e compartilhar funcionam.
 * Celular: número principal, régua, filtros e a linha de prumo; detalhe e cadastro sobem num painel (`Sheet`).
 * Computador: destaques (a pagar · atrasado · pago · total), régua e "por categoria" lado a lado, lista em colunas com seções
 * recolhíveis, seleção múltipla e atalhos de teclado. O detalhe fica num painel fixo ao lado da lista (≥1280 px; abaixo
 * disso, painel lateral por cima) e "Nova conta" abre um painel lateral de altura total.
 */
export default function MonthPage() {
  const [panel, setPanel] = useState<Panel>(null)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false) // celular: busca e categoria ficam atrás de um botão
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string>() // última marcada (Shift+clique marca o intervalo até ela)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = usePref<SectionId[]>(COLLAPSED_KEY, [])
  const searchRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const desktop = useIsDesktop()
  const sidePanel = useHasSidePanel() && desktop
  const [params] = useSearchParams()
  const search = params.get('mes') ? `?mes=${params.get('mes')}` : ''

  const [month, setMonth] = useMonthParam()
  const today = todayISO()
  const isCurrent = month === currentMonth()
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''

  const categories = useCategories(houseId)
  const categoryActions = useCategoryActions(houseId)
  const payees = usePayees(houseId)
  const invoices = useInvoices(houseId, month)
  const actions = useInvoiceActions(houseId)

  const allCategories = useMemo(() => categories.data ?? [], [categories.data])
  const categoryById = useMemo(() => new Map(allCategories.map((c) => [c.id, c])), [allCategories])
  const payeeById = useMemo(() => new Map((payees.data ?? []).map((p) => [p.id, p])), [payees.data])
  const list = useMemo(() => invoices.data ?? [], [invoices.data])
  const counts = useMemo(
    () => ({ all: list.length, open: list.filter((i) => i.status !== 'paid').length, paid: list.filter((i) => i.status === 'paid').length }),
    [list],
  )
  // Filtro de categoria e busca valem por cima do filtro de situação (e as contagens dos botões ignoram a situação).
  const visible = useMemo(
    () => filterInvoices(list, { status, categoryId: categoryFilter || undefined, query }, allCategories, payees.data),
    [list, status, categoryFilter, query, allCategories, payees.data],
  )
  const sections = useMemo(() => sectionsOf(visible), [visible])
  // Ordem em que as linhas aparecem (↑/↓, Shift+clique): no computador, por seção, sem as recolhidas.
  const order = useMemo(
    () => (desktop ? sections.filter((s) => !collapsed.includes(s.id)).flatMap((s) => s.items) : visible),
    [desktop, sections, collapsed, visible],
  )
  // Por categoria: a mãe soma as filhas (a conta fica na categoria mais específica; ver lib/categories).
  const byCategory = useMemo(() => {
    const sums = new Map<string, { totalCents: number; paidCents: number }>()
    for (const i of list) {
      const cur = sums.get(i.categoryId) ?? { totalCents: 0, paidCents: 0 }
      cur.totalCents += i.amountCents
      if (i.status === 'paid') cur.paidCents += i.paid?.amountCents ?? i.amountCents
      sums.set(i.categoryId, cur)
    }
    return rollup([...sums.entries()].map(([categoryId, v]) => ({ categoryId, ...v })), allCategories).slice(0, 5)
  }, [list, allCategories])

  const panelInvoice = panel ? list.find((i) => i.id === panel.id) : undefined
  const purchase = usePurchase(houseId, panelInvoice?.series?.kind === 'installment' ? panelInvoice.series.purchaseId : undefined)
  const canWrite = house?.role !== 'viewer'

  // Seleção que saiu da lista (paga por outra pessoa, mês trocado, filtro) não deve ficar "marcada" escondida.
  const visibleIds = useMemo(() => new Set(order.map((i) => i.id)), [order])
  const checkedVisible = useMemo(() => new Set([...checked].filter((id) => visibleIds.has(id))), [checked, visibleIds])

  // Um toque: paga com a carteira sugerida pela categoria (Mercado -> benefício); sem sugestão, a livre.
  const walletFor = (inv: Invoice) => categoryById.get(inv.categoryId)?.defaultWallet ?? 'free'
  function togglePaid(inv: Invoice) {
    if (inv.status === 'paid') {
      actions.unpay.mutate(inv.id, { onError: () => toast({ message: 'Não foi possível desfazer o pagamento.' }) })
      return
    }
    const wallet = walletFor(inv)
    actions.pay.mutate(
      { id: inv.id, wallet },
      {
        onSuccess: (result) =>
          toast({
            // O servidor avisa (sem bloquear) quando o saldo de benefício do mês fica negativo.
            message: result?.warnings?.includes('benefit_balance_insufficient')
              ? `${inv.description} paga na ${walletLabel[wallet]}. Atenção: o saldo de benefício deste mês ficou negativo.`
              : `${inv.description} paga na ${walletLabel[wallet]}.`,
            actionLabel: 'Desfazer',
            onAction: () => actions.unpay.mutate(inv.id),
          }),
        onError: () => toast({ message: 'Não foi possível marcar como paga. Tente de novo.' }),
      },
    )
  }

  // Pagar várias: uma por vez (cada uma com a carteira da sua categoria). O Desfazer desfaz só as que deram certo.
  async function payChecked() {
    const targets = order.filter((i) => checkedVisible.has(i.id) && i.status !== 'paid')
    const done: Invoice[] = []
    for (const inv of targets) {
      try {
        await actions.pay.mutateAsync({ id: inv.id, wallet: walletFor(inv) })
        done.push(inv)
      } catch {
        // segue com as outras; o aviso diz quantas falharam
      }
    }
    setChecked(new Set())
    const failed = targets.length - done.length
    toast({
      message: failed === 0
        ? `${done.length} ${done.length === 1 ? 'conta paga' : 'contas pagas'}.`
        : `${done.length} de ${targets.length} pagas. ${failed === 1 ? 'Uma falhou' : `${failed} falharam`}: tente de novo.`,
      ...(done.length > 0 ? { actionLabel: 'Desfazer', onAction: () => done.forEach((i) => actions.unpay.mutate(i.id)) } : {}),
    })
  }

  function check(inv: Invoice, range: boolean) {
    const next = new Set(checked)
    if (range && anchor) {
      const [a, b] = [order.findIndex((i) => i.id === anchor), order.findIndex((i) => i.id === inv.id)]
      if (a >= 0 && b >= 0) {
        for (const i of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(i.id)
        setChecked(next)
        setAnchor(inv.id)
        return
      }
    }
    if (next.has(inv.id)) next.delete(inv.id)
    else next.add(inv.id)
    setChecked(next)
    setAnchor(inv.id)
  }

  function remove(inv: Invoice, scope: SeriesScope) {
    actions.remove.mutate({ id: inv.id, scope }, {
      onSuccess: () => {
        setPanel(null)
        // Em lote, o Desfazer restaura o lote inteiro (mesmo escopo); exclusões avulsas anteriores continuam excluídas.
        const batch = scope === 'following' && inv.series
        toast({
          message: batch ? 'Esta e as seguintes foram excluídas.' : `${inv.description} excluída.`,
          actionLabel: 'Desfazer',
          onAction: () =>
            actions.restore.mutate(
              { id: inv.id, scope: batch ? 'following' : 'this' },
              { onError: () => toast({ message: 'Não foi possível desfazer. Restaure uma a uma.' }) },
            ),
        })
      },
      onError: () => toast({ message: 'Não foi possível excluir.' }),
    })
  }

  // Abre a conta que já tem o boleto importado: ela pode ser de outro mês, então pergunta o detalhe e vai até o mês dela.
  async function openInvoice(id: string) {
    try {
      const inv = await getInvoice(houseId, id)
      setMonth(inv.competenceMonth)
      setCreating(false)
      setPanel({ id, mode: 'view' })
    } catch {
      toast({ message: 'Não foi possível abrir a conta.' })
    }
  }

  const openNew = () => {
    setPanel(null)
    setCreating(true)
  }

  // Atalhos de teclado (computador). Não valem enquanto se digita num campo nem com um painel modal aberto (ele cuida do Esc).
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onShortcut = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (document.querySelector('[role="dialog"]')) return
    const target = document.activeElement
    if (isTyping(target)) {
      if (e.key === 'Escape' && target === searchRef.current) searchRef.current?.blur()
      return
    }
    const focusRow = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus()
    const current = rowIdOf(target)
    const k = e.key
    if ((k === 'n' || k === 'N') && canWrite) {
      e.preventDefault()
      openNew()
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      setMonth(addMonths(month, k === 'ArrowLeft' ? -1 : 1))
    } else if (k === '/') {
      e.preventDefault()
      searchRef.current?.focus()
    } else if (k === '?') {
      setHelpOpen((o) => !o)
    } else if (k === 'Escape') {
      if (helpOpen) setHelpOpen(false)
      else if (checked.size > 0) setChecked(new Set())
      else if (panel) setPanel(null)
    } else if (k === 'ArrowDown' || k === 'ArrowUp') {
      if (order.length === 0) return
      e.preventDefault()
      const at = order.findIndex((i) => i.id === (current ?? panel?.id))
      const next = at < 0 ? (k === 'ArrowDown' ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + (k === 'ArrowDown' ? 1 : -1)))
      focusRow(order[next].id)
    } else if (k === 'Enter' && current) {
      e.preventDefault()
      setPanel({ id: current, mode: 'view' })
    } else if (k === ' ' || k === 'p' || k === 'P') {
      // Espaço só paga com uma linha em foco (em outro botão, o Espaço aperta o botão); P paga também a conta aberta.
      const id = current ?? (k === ' ' ? undefined : panel?.id)
      const inv = id ? list.find((i) => i.id === id) : undefined
      if (!inv || !canWrite) return
      e.preventDefault()
      togglePaid(inv)
    }
  }
  // O ouvinte fica instalado uma vez; o ref aponta sempre para a versão mais nova (com o estado atual) do tratador.
  useEffect(() => {
    keys.current = onShortcut
  })
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => keys.current(e)
    // O navegador "aperta" o botão em foco ao soltar o Espaço: numa linha, o Espaço já pagou no keydown.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && rowIdOf(document.activeElement) && !document.querySelector('[role="dialog"]')) e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [desktop])

  if (!house) return null
  const total = list.reduce((s, i) => s + i.amountCents, 0)
  const toPay = list.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amountCents, 0)
  const paidTotal = list.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.paid?.amountCents ?? i.amountCents), 0)
  const overdue = list.filter((i) => i.status === 'overdue')
  const overdueTotal = overdue.reduce((s, i) => s + i.amountCents, 0)
  const fraction = total > 0 ? list.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amountCents, 0) / total : 0
  const busy = actions.pay.isPending || actions.unpay.isPending
  const activeCategories = allCategories.filter((c) => !c.archived || c.id === panelInvoice?.categoryId)
  const empty = invoices.isSuccess && list.length === 0
  const filtering = Boolean(query.trim() || categoryFilter)
  const overdueText = overdue.length === 0 ? 'nenhuma conta atrasada' : `${overdue.length} ${overdue.length === 1 ? 'conta atrasada' : 'contas atrasadas'}`

  // Categoria na linha: some quando a descrição já é o nome dela ("Luz / Luz"); no computador, "Mãe › Filha".
  const categoryName = (inv: Invoice, full?: boolean) => {
    const c = categoryById.get(inv.categoryId)
    if (repeatsCategory(inv.description, c)) return undefined
    return c ? (full ? categoryPath(c, allCategories) : c.name) : 'Sem categoria'
  }
  const checkedOpen = order.filter((i) => checkedVisible.has(i.id) && i.status !== 'paid')
  const checkedSum = checkedOpen.reduce((s, i) => s + i.amountCents, 0)

  const formProps = {
    month,
    categories: activeCategories,
    payees: payees.data,
    canWrite,
    onCreate: (body: Parameters<typeof actions.create.mutateAsync>[0]) => actions.create.mutateAsync(body),
    onCreatePurchase: (body: Parameters<typeof actions.createPurchase.mutateAsync>[0]) => actions.createPurchase.mutateAsync(body),
    onCreateRecurrence: (body: Parameters<typeof actions.createRecurrence.mutateAsync>[0]) => actions.createRecurrence.mutateAsync(body),
    onUpdate: (id: string, body: Parameters<typeof actions.update.mutateAsync>[0]['body'], scope: SeriesScope) => actions.update.mutateAsync({ id, body, scope }),
    onCreateCategory: (body: Parameters<typeof categoryActions.create.mutateAsync>[0]) => categoryActions.create.mutateAsync(body) as Promise<Category>,
    // reset() limpa as variáveis da mutação (arquivo e senha) assim que a resposta chega.
    onExtractBoleto: (file: File, password?: string) => extractDocument(houseId, file, password),
    onOpenInvoice: (id: string) => void openInvoice(id),
  }
  const ready = categories.isSuccess

  // O detalhe (leitura) e a edição, iguais em todos os lugares onde aparecem (painel fixo, painel lateral, Sheet).
  const detail = panelInvoice && (
    <InvoiceDetail
      invoice={panelInvoice}
      categoryLabel={categoryPath(categoryById.get(panelInvoice.categoryId), allCategories) ?? 'Sem categoria'}
      payeeName={panelInvoice.payeeId ? payeeById.get(panelInvoice.payeeId)?.name : undefined}
      purchase={purchase.data}
      today={today}
      payWallet={walletFor(panelInvoice)}
      canWrite={canWrite}
      busy={busy}
      onPay={(inv) => {
        togglePaid(inv)
        if (!desktop) setPanel(null)
      }}
      onUnpay={(inv) => actions.unpay.mutate(inv.id, { onError: () => toast({ message: 'Não foi possível desfazer o pagamento.' }) })}
      onEdit={() => setPanel({ id: panelInvoice.id, mode: 'edit' })}
      onDelete={remove}
    />
  )
  const editForm = panelInvoice && ready && (
    <InvoiceForm
      key={panelInvoice.id}
      {...formProps}
      invoice={panelInvoice}
      onDone={() => setPanel({ id: panelInvoice.id, mode: 'view' })}
      onCancel={() => setPanel({ id: panelInvoice.id, mode: 'view' })}
    />
  )
  const newForm = ready && <InvoiceForm key="nova" {...formProps} onDone={() => setCreating(false)} />

  const statusFilters: Array<[StatusFilter, string]> = [['all', 'Todas'], ['open', 'A pagar'], ['paid', 'Pagas']]
  const statusGroup = (
    <div role="group" aria-label="Filtrar contas" className="flex gap-1.5">
      {statusFilters.map(([key, text]) => (
        <button
          key={key}
          aria-pressed={status === key}
          onClick={() => setStatus(key)}
          className={`h-10 whitespace-nowrap rounded-md border px-3 text-[13px] transition-colors md:h-9 ${status === key ? 'border-structure bg-structure font-semibold text-on-structure' : 'border-ink/30 font-medium hover:bg-ink/5'}`}
        >
          {text} <span className="font-mono opacity-85">{counts[key]}</span>
        </button>
      ))}
    </div>
  )
  const tree = buildTree(allCategories.filter((c) => !c.archived || list.some((i) => i.categoryId === c.id)))
  const categorySelect = (
    <select
      aria-label="Filtrar por categoria"
      value={categoryFilter}
      onChange={(e) => setCategoryFilter(e.target.value)}
      className="h-10 min-w-0 rounded-md border border-ink/30 bg-surface px-2.5 text-[13px] text-ink md:h-9"
    >
      <option value="">Todas as categorias</option>
      {tree.map((n) => [
        <option key={n.category.id} value={n.category.id}>{n.category.name}{n.children.length > 0 ? ' (todas)' : ''}</option>,
        ...n.children.map((c) => <option key={c.id} value={c.id}>{`${n.category.name} › ${c.name}`}</option>),
      ])}
    </select>
  )
  const searchBox = (
    <label className="relative flex min-w-0 flex-1 items-center md:max-w-72">
      <Search size={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-ink/60" />
      <input
        ref={searchRef}
        type="search"
        aria-label="Buscar contas"
        placeholder={desktop ? 'Buscar  ( / )' : 'Buscar'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-ink/30 bg-surface pl-8 pr-2.5 text-base text-ink placeholder:text-ink/55 md:h-9 md:text-[13px]"
      />
    </label>
  )
  const clearFilters = () => {
    setQuery('')
    setCategoryFilter('')
    setStatus('all')
  }

  const emptyState = empty ? (
    <div className="mt-2 flex flex-col items-start gap-3 rounded-md border border-dashed border-ink/25 p-5">
      <p className="text-sm text-ink/80">Nenhuma conta neste mês.</p>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={openNew} className="flex items-center gap-2">
            <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> Lançar a primeira conta
          </Button>
          <Link to={{ pathname: '/importar', search }} className="flex h-11 items-center gap-2 rounded-md border border-ink/25 px-4 text-sm font-semibold transition-colors hover:bg-ink/5">
            <FileUp size={18} strokeWidth={1.5} aria-hidden="true" /> Importar
          </Link>
        </div>
      )}
    </div>
  ) : invoices.isSuccess && visible.length === 0 ? (
    <p className="mt-2 rounded-md border border-dashed border-ink/25 p-4 text-sm text-ink/80">
      Nenhuma conta com esse filtro.{' '}
      <button className="font-semibold text-accent underline underline-offset-2" onClick={clearFilters}>Limpar filtros</button>
    </p>
  ) : null

  const seriesLink = (
    <Link to={{ pathname: '/parcelas', search }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent underline underline-offset-2">
      <Layers size={15} strokeWidth={1.5} aria-hidden="true" /> Parcelas e fixas
    </Link>
  )

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-36 pt-2 md:max-w-[1600px] md:gap-6 md:px-8 md:pb-10 md:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <MonthSelector month={month} onChange={setMonth} />
          {desktop && (
            <div className="flex flex-wrap items-center gap-2">
              {seriesLink}
              {canWrite && (
                <Link
                  to={{ pathname: '/importar', search }}
                  className="ml-2 flex h-10 items-center gap-2 rounded-md border border-ink/30 px-3.5 text-sm font-semibold transition-colors hover:bg-ink/5"
                >
                  <FileUp size={18} strokeWidth={1.5} aria-hidden="true" /> Importar
                </Link>
              )}
              {canWrite && (
                <Button onClick={openNew} title="Nova conta (N)" className="flex h-10 items-center gap-2">
                  <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> Nova conta
                  <kbd className="ml-1 rounded-sm border border-on-structure/40 px-1 font-mono text-[10px] leading-4">N</kbd>
                </Button>
              )}
              <ShortcutsHelp open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} />
            </div>
          )}
        </header>

        {/* Destaques */}
        {desktop ? (
          <section aria-label="Resumo do mês" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md bg-structure px-4 py-3.5 text-on-structure">
              <div className={`flex justify-between ${label} text-on-structure/85`}>
                <span>a pagar</span>
                <span className="font-mono">{Math.round(fraction * 100)}% pago</span>
              </div>
              <p className="font-mono text-[34px] font-semibold leading-tight tracking-tight tabular-nums">{formatCents(toPay)}</p>
              <PaidGauge fraction={fraction} tone="dark" className="mt-2" />
            </div>
            <Highlight title="atrasado" alert={overdue.length > 0} value={formatCents(overdueTotal)}>
              <span aria-hidden="true" className={`font-mono text-xs ${overdue.length > 0 ? 'text-alert' : 'text-accent'}`}>{overdue.length > 0 ? '[ ✖ ]' : '[ ▪ ]'}</span>
              {overdueText}
            </Highlight>
            <Highlight title="pago" value={formatCents(paidTotal)} valueClass="text-accent">
              {counts.paid} de {counts.all} contas
            </Highlight>
            <Highlight title="total do mês" value={formatCents(total)}>
              {counts.all} {counts.all === 1 ? 'conta' : 'contas'}
            </Highlight>
          </section>
        ) : (
          <section aria-label="Resumo do mês" className="px-1">
            <div className={`flex justify-between ${label} text-ink/80`}>
              <span>a pagar neste mês</span>
              <span className="font-mono">{Math.round(fraction * 100)}% pago</span>
            </div>
            <p className="font-mono text-[40px] font-semibold leading-tight tracking-tight tabular-nums text-heading">{formatCents(toPay)}</p>
            <PaidGauge fraction={fraction} className="mt-2" />
            <p className="mt-2 flex justify-between gap-3 text-xs text-ink/80">
              <span>
                <span className="font-mono font-semibold text-ink">{formatCents(paidTotal)}</span> pago · {counts.paid} de {counts.all}
              </span>
              <span className="font-mono">de {formatCents(total)}</span>
            </p>
            {overdue.length > 0 && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
                <span aria-hidden="true" className="font-mono text-alert">[ ✖ ]</span>
                <span className="font-mono">{formatCents(overdueTotal)}</span> em atraso ({overdue.length})
              </p>
            )}
          </section>
        )}

        {/* Régua do mês e, no computador, "por categoria" ao lado */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <section aria-label="Régua do mês" className="rounded-md border border-line px-2.5 pb-1.5 pt-2.5 md:px-4 md:pb-3 md:pt-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={`${label} text-ink/80`}>régua do mês</h2>
              <p className="hidden items-center gap-4 text-xs text-ink/85 md:flex">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-structure" />paga</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-accent" />a vencer</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-alert" />atrasada</span>
              </p>
              <p className="text-[11px] text-ink/75 md:hidden">cada barra é um dia</p>
            </div>
            <MonthRuler invoices={list} month={month} todayDay={isCurrent ? Number(today.slice(8, 10)) : undefined} barArea={desktop ? 168 : 52} />
          </section>
          {desktop && byCategory.length > 0 && (
            <section aria-label="Por categoria" className="rounded-md border border-line p-4">
              <h2 className={`${label} mb-3 text-ink/80`}>por categoria</h2>
              <CategoryBreakdown rows={byCategory} gap="gap-2.5" />
            </section>
          )}
        </div>

        {invoices.isPending && <p role="status" className="text-sm text-ink/70">carregando…</p>}
        {invoices.isError && (
          <p role="alert" className="rounded-md border border-alert/60 bg-alert/10 px-3 py-2 text-sm">
            <span className="font-mono text-alert">[ ✖ ]</span> Não foi possível carregar as contas.{' '}
            <button className="font-semibold underline" onClick={() => void invoices.refetch()}>
              Tentar de novo
            </button>
          </p>
        )}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <section aria-label="Contas do mês" className="@container min-w-0 flex-1">
            {desktop ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="mr-auto font-display text-[26px] font-bold text-heading font-stretch-condensed">Contas do mês</h2>
                {statusGroup}
                {categorySelect}
                {searchBox}
              </div>
            ) : (
              <div className="mb-1 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  {statusGroup}
                  <button
                    aria-label="Buscar e filtrar por categoria"
                    aria-expanded={filtersOpen || filtering}
                    onClick={() => setFiltersOpen((o) => !o)}
                    className={`relative flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors ${filtering ? 'border-structure bg-structure text-on-structure' : 'border-ink/30'}`}
                  >
                    <Search size={18} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
                {(filtersOpen || filtering) && (
                  <div className="flex gap-2">
                    {searchBox}
                    {categorySelect}
                  </div>
                )}
              </div>
            )}

            {emptyState}
            {desktop ? (
              <MonthSections
                sections={sections}
                collapsed={collapsed}
                onToggle={(id) => setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id])}
                categoryName={categoryName}
                today={isCurrent ? today : undefined}
                selectedId={panel?.id}
                canWrite={canWrite}
                busy={busy}
                onTogglePaid={togglePaid}
                onOpen={(inv) => { setCreating(false); setPanel({ id: inv.id, mode: 'view' }) }}
                checked={checkedVisible}
                onCheck={check}
              />
            ) : (
              <Timeline
                invoices={visible}
                categoryName={categoryName}
                today={isCurrent ? today : undefined}
                canWrite={canWrite}
                busy={busy}
                onTogglePaid={togglePaid}
                onOpen={(inv) => setPanel({ id: inv.id, mode: 'view' })}
              />
            )}
            {!desktop && list.length > 0 && <p className="mt-4 px-3">{seriesLink}</p>}

            {desktop && checkedVisible.size > 0 && (
              <div role="region" aria-label="Contas selecionadas" className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-md bg-structure px-4 py-2.5 text-on-structure motion-safe:animate-fade-in">
                <span className="text-sm">
                  {checkedVisible.size} {checkedVisible.size === 1 ? 'selecionada' : 'selecionadas'}
                </span>
                {checkedOpen.length > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => void payChecked()}
                    className="h-9 rounded-md bg-on-structure px-3.5 text-sm font-semibold text-heading transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Pagar {checkedOpen.length} {checkedOpen.length === 1 ? 'selecionada' : 'selecionadas'} ({formatCents(checkedSum)})
                  </button>
                )}
                <button onClick={() => setChecked(new Set())} className="ml-auto flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold underline underline-offset-2">
                  <X size={16} strokeWidth={1.5} aria-hidden="true" /> Limpar seleção
                </button>
              </div>
            )}
          </section>

          {sidePanel && (
            <aside className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:w-[380px] xl:overflow-y-auto 2xl:w-[440px]">
              {panelInvoice ? (
                <section aria-label="Detalhes da conta" className="rounded-md border-2 border-structure p-4 motion-safe:animate-fade-in">
                  <PanelHeader title={panel?.mode === 'edit' ? 'Editar conta' : panelInvoice.description} onClose={() => setPanel(null)} />
                  {panel?.mode === 'edit' ? editForm : detail}
                </section>
              ) : (
                <Overview
                  list={list}
                  today={today}
                  isCurrent={isCurrent}
                  onOpen={(inv) => setPanel({ id: inv.id, mode: 'view' })}
                  actions={
                    canWrite && (
                      <p className="text-xs text-ink/75">
                        Selecione uma conta para ver os detalhes. Nova conta: tecla <kbd className="font-mono">N</kbd>; todos os atalhos: <kbd className="font-mono">?</kbd>
                      </p>
                    )
                  }
                />
              )}
            </aside>
          )}
        </div>
      </main>

      {!desktop && canWrite && (
        <button
          aria-label="Nova conta"
          onClick={openNew}
          className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-md bg-structure text-on-structure shadow-[0_2px_0_var(--color-ink)] transition-colors hover:bg-structure/90"
        >
          <Plus size={28} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {/* Lançar conta: painel lateral (computador) ou painel que sobe (celular). */}
      {creating && desktop && newForm && (
        <SlideOver title="Nova conta" onClose={() => setCreating(false)}>
          {newForm}
        </SlideOver>
      )}
      {creating && !desktop && ready && (
        <InvoiceSheet key="nova" {...formProps} onDone={() => setCreating(false)} onClose={() => setCreating(false)} />
      )}

      {/* Detalhe: computador estreito (sem painel fixo) usa o painel lateral; celular, o Sheet. */}
      {panelInvoice && desktop && !sidePanel && (
        <SlideOver title={panel?.mode === 'edit' ? 'Editar conta' : 'Detalhes da conta'} onClose={() => setPanel(null)}>
          {panel?.mode === 'edit' ? editForm : <><h3 className="mb-3 text-lg font-semibold">{panelInvoice.description}</h3>{detail}</>}
        </SlideOver>
      )}
      {panelInvoice && !desktop && panel?.mode === 'view' && (
        <Sheet title="Detalhes da conta" onClose={() => setPanel(null)}>
          <h3 className="mb-3 text-lg font-semibold">{panelInvoice.description}</h3>
          {detail}
        </Sheet>
      )}
      {panelInvoice && !desktop && panel?.mode === 'edit' && ready && (
        <InvoiceSheet
          key={panelInvoice.id}
          {...formProps}
          invoice={panelInvoice}
          onDone={() => setPanel({ id: panelInvoice.id, mode: 'view' })}
          onCancel={() => setPanel({ id: panelInvoice.id, mode: 'view' })}
          onClose={() => setPanel(null)}
        />
      )}
    </AppShell>
  )
}

function Highlight({ title, value, valueClass = '', alert = false, children }: { title: string; value: string; valueClass?: string; alert?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-md border px-4 py-3.5 ${alert ? 'border-alert/70' : 'border-line'}`}>
      <p className={`${label} text-ink/80`}>{title}</p>
      <p className={`font-mono text-[34px] font-semibold leading-tight tracking-tight tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-1.5 flex items-center gap-2 text-[13px] text-ink/80">{children}</p>
    </div>
  )
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <h2 className="min-w-0 break-words font-display text-[22px] font-bold leading-tight text-heading font-stretch-condensed">{title}</h2>
      <button aria-label="Fechar detalhes" title="Fechar (Esc)" onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-ink/5">
        <X size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * O painel ao lado da lista quando nenhuma conta está aberta: os próximos vencimentos (7 dias, com as atrasadas primeiro)
 * e os atalhos. Em outro mês, as primeiras contas ainda não pagas daquele mês.
 */
function Overview({ list, today, isCurrent, onOpen, actions }: { list: Invoice[]; today: string; isCurrent: boolean; onOpen: (inv: Invoice) => void; actions: ReactNode }) {
  const items = (isCurrent ? dueSoon(list, today) : list.filter((i) => i.status !== 'paid')).slice(0, 8)
  const sum = items.reduce((s, i) => s + i.amountCents, 0)
  return (
    <section aria-label="Próximos vencimentos" className="flex flex-col gap-4 rounded-md border border-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`${label} text-ink/80`}>{isCurrent ? 'próximos 7 dias' : 'a pagar neste mês'}</h2>
        {items.length > 0 && <span className="font-mono text-[13px] font-semibold tabular-nums">{formatCents(sum)}</span>}
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink/80">
          <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span>
          {isCurrent ? 'Nada vence nos próximos 7 dias.' : 'Nada a pagar neste mês.'}
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => onOpen(i)} className="flex min-h-9 w-full items-center gap-3 rounded-sm px-2 text-left text-sm transition-colors hover:bg-ink/5">
                <span aria-hidden="true" className={`font-mono text-xs ${i.status === 'overdue' ? 'text-alert' : 'text-ink/70'}`}>{i.status === 'overdue' ? '[ ✖ ]' : '[ ▫ ]'}</span>
                <span className="w-11 font-mono text-xs tabular-nums text-ink/80">{dayMonth(i.dueDate)}</span>
                <span className="min-w-0 flex-1 truncate">{i.description}</span>
                <span className="font-mono text-[13px] font-semibold tabular-nums">{formatCents(i.amountCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {actions}
    </section>
  )
}
