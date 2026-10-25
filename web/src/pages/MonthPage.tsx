import { FileUp, Layers, Plus, Search, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getInvoice, useCategories, useCategoryActions, extractDocument, useInvoiceActions, useInvoices, usePayees, usePurchase, useWallets } from '../api/queries'
import type { Category, Invoice, SeriesScope } from '../api/types'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { InvoiceDetail } from '../components/InvoiceDetail'
import { InvoiceForm } from '../components/InvoiceForm'
import { InvoiceSheet } from '../components/InvoiceSheet'
import { MonthFocus } from '../components/MonthFocus'
import { MonthRuler } from '../components/MonthRuler'
import { MonthSections } from '../components/MonthSections'
import { MonthSelector } from '../components/MonthSelector'
import { Sheet } from '../components/Sheet'
import { ShortcutsHelp } from '../components/ShortcutsHelp'
import { SlideOver } from '../components/SlideOver'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/toastContext'
import { Button, ButtonLink } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Eyebrow } from '../components/ui/Eyebrow'
import { FilterChips } from '../components/ui/FilterChips'
import { ListSkeleton } from '../components/ui/ListSkeleton'
import { Notice } from '../components/ui/Notice'
import { SectionTitle } from '../components/ui/SectionTitle'
import { Surface } from '../components/ui/Surface'
import { buildTree, categoryPath } from '../lib/categories'
import { pulsePaid } from '../lib/flash'
import { addMonths, currentMonth, todayISO } from '../lib/dates'
import { filterInvoices, repeatsCategory, sectionsOf, type SectionId, type StatusFilter } from '../lib/monthList'
import { useHasSidePanel } from '../lib/media'
import { formatCents } from '../lib/money'
import { usePref } from '../lib/storage'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'
import { activeWallets, defaultWallet, walletName } from '../lib/wallets'

/** A conta aberta: em leitura (detalhe) ou no formulário (editar). */
type Panel = { id: string; mode: 'view' | 'edit' } | null

const ImportModal = lazy(() => import('../components/ImportModal'))
const COLLAPSED_KEY = 'prumia.mes.secoesRecolhidas'

const isTyping = (el: Element | null) => Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
const rowIdOf = (el: Element | null) => (el?.closest('[data-row-id]') as HTMLElement | null)?.dataset.rowId

/**
 * A visão do mês. O mês escolhido fica na URL (?mes=2026-10): voltar e compartilhar funcionam.
 * Direção "Instrumento calmo": UM destaque que muda com o estado do mês (`MonthFocus`: atrasadas, próximos 7 dias ou mês
 * quitado), os números de contexto ao lado sem caixa, a régua solta e a lista em seções tipográficas (`SectionRule`).
 * Celular: a mesma ordem em coluna, com a linha de prumo; detalhe e cadastro sobem num painel (`Sheet`).
 * Computador: lista em colunas com seções recolhíveis, seleção múltipla e atalhos de teclado. O detalhe fica num painel
 * fixo ao lado da lista (≥1280 px; abaixo disso, painel lateral por cima) e "Nova conta" abre um painel lateral de altura total.
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
  const [importing, setImporting] = useState(false) // computador: a importação abre num modal grande sobre o mês
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
  const panelInvoice = panel ? list.find((i) => i.id === panel.id) : undefined
  const purchase = usePurchase(houseId, panelInvoice?.series?.kind === 'installment' ? panelInvoice.series.purchaseId : undefined)
  const canWrite = house?.role !== 'viewer'

  // Seleção que saiu da lista (paga por outra pessoa, mês trocado, filtro) não deve ficar "marcada" escondida.
  const visibleIds = useMemo(() => new Set(order.map((i) => i.id)), [order])
  const checkedVisible = useMemo(() => new Set([...checked].filter((id) => visibleIds.has(id))), [checked, visibleIds])

  // Um toque: paga com a carteira sugerida pela categoria (Mercado -> Benefício); sem sugestão, a padrão da casa.
  const walletList = useWallets(houseId).data
  const payable = useMemo(() => activeWallets(walletList ?? []), [walletList])
  const walletFor = (inv: Invoice) => {
    const wanted = categoryById.get(inv.categoryId)?.defaultWalletId
    return payable.find((w) => w.id === wanted)?.id ?? defaultWallet(payable)?.id ?? ''
  }
  function togglePaid(inv: Invoice, chosen?: string) {
    if (inv.status === 'paid') {
      actions.unpay.mutate(inv.id, { onError: () => toast({ message: 'Não foi possível desfazer o pagamento.' }) })
      return
    }
    const walletId = chosen ?? walletFor(inv)
    actions.pay.mutate(
      { id: inv.id, walletId },
      {
        onSuccess: (result) => {
          pulsePaid(inv.id)
          toast({
            // O servidor avisa (sem bloquear) quando o saldo de uma carteira com aviso ligado fica negativo.
            message: result?.warnings?.includes('wallet_balance_insufficient')
              ? `${inv.description} paga na carteira ${walletName(walletList, walletId)}. Atenção: o saldo dela ficou negativo.`
              : `${inv.description} paga na carteira ${walletName(walletList, walletId)}.`,
            actionLabel: 'Desfazer',
            onAction: () => actions.unpay.mutate(inv.id),
          })
        },
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
        await actions.pay.mutateAsync({ id: inv.id, walletId: walletFor(inv) })
        done.push(inv)
        pulsePaid(inv.id)
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
  const busy = actions.pay.isPending || actions.unpay.isPending
  const activeCategories = allCategories.filter((c) => !c.archived || c.id === panelInvoice?.categoryId)
  const empty = invoices.isSuccess && list.length === 0
  const filtering = Boolean(query.trim() || categoryFilter)

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
    houseId,
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
      wallets={payable}
      payWalletId={walletFor(panelInvoice)}
      canWrite={canWrite}
      busy={busy}
      onPay={(inv, walletId) => {
        togglePaid(inv, walletId)
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

  const statusGroup = (
    <FilterChips<StatusFilter>
      label="Filtrar contas"
      value={status}
      onChange={setStatus}
      options={[
        { value: 'all', label: 'Todas', count: counts.all },
        { value: 'open', label: 'A pagar', count: counts.open },
        { value: 'paid', label: 'Pagas', count: counts.paid },
      ]}
    />
  )
  const tree = buildTree(allCategories.filter((c) => !c.archived || list.some((i) => i.categoryId === c.id)))
  const field = 'h-11 min-w-0 rounded-md border border-line-strong bg-raised text-ink transition-colors hover:border-ink/50 focus-visible:border-accent md:h-9'
  const categorySelect = (
    <select aria-label="Filtrar por categoria" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={`${field} px-2.5 text-ui`}>
      <option value="">Todas as categorias</option>
      {tree.map((n) => [
        <option key={n.category.id} value={n.category.id}>{n.category.name}{n.children.length > 0 ? ' (todas)' : ''}</option>,
        ...n.children.map((c) => <option key={c.id} value={c.id}>{`${n.category.name} › ${c.name}`}</option>),
      ])}
    </select>
  )
  const searchBox = (
    <label className="relative flex min-w-0 flex-1 items-center md:max-w-72">
      <Search size={16} strokeWidth={1.5} aria-hidden="true" className="pointer-events-none absolute left-2.5 text-muted" />
      <input
        ref={searchRef}
        type="search"
        aria-label="Buscar contas"
        placeholder={desktop ? 'Buscar  ( / )' : 'Buscar'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={`${field} w-full pl-8 pr-2.5 text-base placeholder:text-muted md:text-ui`}
      />
    </label>
  )
  const clearFilters = () => {
    setQuery('')
    setCategoryFilter('')
    setStatus('all')
  }

  const emptyState = empty ? (
    <EmptyState
      title="Nenhuma conta neste mês."
      className="mt-2"
      actions={
        canWrite && (
          <>
            <Button onClick={openNew}>
              <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> Lançar a primeira conta
            </Button>
            <ButtonLink to={{ pathname: '/importar', search }}>
              <FileUp size={18} strokeWidth={1.5} aria-hidden="true" /> Importar
            </ButtonLink>
          </>
        )
      }
    >
      Lance uma conta ou importe boletos e faturas deste mês.
    </EmptyState>
  ) : invoices.isSuccess && visible.length === 0 ? (
    <EmptyState
      compact
      className="mt-2 px-1"
      title={
        <>
          Nenhuma conta com esse filtro.{' '}
          <button className="min-h-8 font-semibold text-accent underline underline-offset-2" onClick={clearFilters}>Limpar filtros</button>
        </>
      }
    />
  ) : null

  const seriesLink = (
    <ButtonLink to={{ pathname: '/parcelas', search }} variant="quiet" size={desktop ? 'md' : 'sm'}>
      <Layers size={16} strokeWidth={1.5} aria-hidden="true" /> Parcelas e fixas
    </ButtonLink>
  )

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-2 md:max-w-[1600px] md:gap-8 md:px-8 md:pb-10 md:pt-8">
        <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-4">
          <MonthSelector month={month} onChange={setMonth} />
          {desktop ? (
            <div className="flex flex-wrap items-center gap-2">
              {seriesLink}
              {canWrite && (
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  <FileUp size={18} strokeWidth={1.5} aria-hidden="true" /> Importar
                </Button>
              )}
              {canWrite && (
                <Button onClick={openNew} title="Nova conta (N)">
                  <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> Nova conta
                  <kbd className="ml-1 rounded-sm bg-on-structure/15 px-1 font-mono text-caption leading-4">N</kbd>
                </Button>
              )}
              <ShortcutsHelp open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} />
            </div>
          ) : (
            // Celular: "Importar" fica sempre à vista (não só no mês vazio); "Nova conta" é o botão flutuante.
            <div className="flex items-center justify-between gap-2">
              {seriesLink}
              {canWrite && (
                <ButtonLink to={{ pathname: '/importar', search }} size="sm">
                  <FileUp size={16} strokeWidth={1.5} aria-hidden="true" /> Importar
                </ButtonLink>
              )}
            </div>
          )}
        </header>

        {invoices.isPending && <ListSkeleton label="Carregando as contas" rows={4} />}
        {invoices.isError && <Notice onRetry={() => void invoices.refetch()}>Não foi possível carregar as contas.</Notice>}

        {/* O destaque do mês e os números ao lado (some no mês vazio: o vazio já diz o que fazer). */}
        {list.length > 0 && (
          <MonthFocus list={list} month={month} today={today} canWrite={canWrite} busy={busy} onPay={togglePaid} compact={!desktop} />
        )}

        {/* Régua do mês, sem caixa: 96 px no computador, 48 px no celular. */}
        {list.length > 0 && (
          <section aria-label="Régua do mês">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <Eyebrow as="h2">régua do mês</Eyebrow>
              <p className="hidden items-center gap-4 text-meta text-muted md:flex">
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-done" />paga</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-accent" />a vencer</span>
                <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-xs bg-alert" />atrasada</span>
              </p>
              <p className="text-caption text-muted md:hidden">cada barra é um dia</p>
            </div>
            <MonthRuler invoices={list} month={month} todayDay={isCurrent ? Number(today.slice(8, 10)) : undefined} barArea={desktop ? 96 : 48} />
          </section>
        )}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <section aria-label="Contas do mês" className="@container min-w-0 flex-1">
            {desktop ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <SectionTitle className="mr-auto">Contas do mês</SectionTitle>
                {statusGroup}
                {categorySelect}
                {searchBox}
              </div>
            ) : (
              <div className="mb-2 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  {statusGroup}
                  <Button
                    variant="icon"
                    aria-label="Buscar e filtrar por categoria"
                    aria-expanded={filtersOpen || filtering}
                    onClick={() => setFiltersOpen((o) => !o)}
                    className={filtering ? 'bg-raised text-heading' : ''}
                  >
                    <Search size={18} strokeWidth={1.5} aria-hidden="true" />
                  </Button>
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
            {desktop && canWrite && list.length > 0 && !panelInvoice && (
              <p className="mt-4 text-meta text-muted">
                Selecione uma conta para ver os detalhes. Nova conta: tecla <kbd className="font-mono">N</kbd>; todos os atalhos: <kbd className="font-mono">?</kbd>
              </p>
            )}

            {desktop && checkedVisible.size > 0 && (
              <div role="region" aria-label="Contas selecionadas" className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-md bg-structure px-4 py-2.5 text-on-structure motion-safe:animate-fade-in">
                <span className="text-sm">
                  {checkedVisible.size} {checkedVisible.size === 1 ? 'selecionada' : 'selecionadas'}
                </span>
                {checkedOpen.length > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => void payChecked()}
                    className="h-9 rounded-md bg-on-structure px-3.5 text-sm font-semibold text-structure transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Pagar {checkedOpen.length} {checkedOpen.length === 1 ? 'selecionada' : 'selecionadas'} ({formatCents(checkedSum)})
                  </button>
                )}
                <button onClick={() => setChecked(new Set())} className="ml-auto flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-semibold underline underline-offset-2 hover:bg-on-structure/10">
                  <X size={16} strokeWidth={1.5} aria-hidden="true" /> Limpar seleção
                </button>
              </div>
            )}
          </section>

          {/* O painel fixo só existe com uma conta aberta: sem ela, a lista usa a largura toda (o destaque já mostra o que vence). */}
          {sidePanel && panelInvoice && (
            <aside className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:w-[380px] xl:overflow-y-auto 2xl:w-[440px]">
              <Surface as="section" aria-label="Detalhes da conta" className="motion-safe:animate-fade-in">
                <PanelHeader title={panel?.mode === 'edit' ? 'Editar conta' : panelInvoice.description} onClose={() => setPanel(null)} />
                {panel?.mode === 'edit' ? editForm : detail}
              </Surface>
            </aside>
          )}
        </div>
      </main>

      {!desktop && canWrite && (
        <button
          aria-label="Nova conta"
          onClick={openNew}
          className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-md bg-structure text-on-structure transition-colors hover:bg-structure/90 motion-safe:active:scale-95"
        >
          <Plus size={28} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {importing && desktop && (
        <Suspense fallback={null}>
          <ImportModal
            onClose={() => setImporting(false)}
            onCreated={(m) => {
              setImporting(false)
              setMonth(m)
            }}
          />
        </Suspense>
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
          {panel?.mode === 'edit' ? editForm : <><SectionTitle as="h3" size="title" className="mb-3">{panelInvoice.description}</SectionTitle>{detail}</>}
        </SlideOver>
      )}
      {panelInvoice && !desktop && panel?.mode === 'view' && (
        <Sheet title="Detalhes da conta" onClose={() => setPanel(null)}>
          <SectionTitle as="h3" size="title" className="mb-3">{panelInvoice.description}</SectionTitle>
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

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <SectionTitle size="title" className="min-w-0 break-words leading-tight">{title}</SectionTitle>
      <Button variant="icon" aria-label="Fechar detalhes" title="Fechar (Esc)" onClick={onClose}>
        <X size={20} strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </div>
  )
}
