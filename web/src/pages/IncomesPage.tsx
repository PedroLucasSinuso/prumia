import { Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useIncomeActions, useIncomeSources, useIncomes, useMembers, useSourceActions, useSummary } from '../api/queries'
import type { Income, IncomeSource, SeriesScope } from '../api/types'
import { useAuth } from '../auth/context'
import { useActiveHouse } from '../auth/useActiveHouse'
import { AppShell } from '../components/AppShell'
import { IncomeDetail } from '../components/IncomeDetail'
import { IncomeForm } from '../components/IncomeForm'
import { IncomeList } from '../components/IncomeList'
import { IncomeSections } from '../components/IncomeSections'
import { MonthSelector } from '../components/MonthSelector'
import { PaidGauge } from '../components/PaidGauge'
import { RepeatingIncomes } from '../components/RepeatingIncomes'
import { Sheet } from '../components/Sheet'
import { ShortcutsHelp, type Shortcut } from '../components/ShortcutsHelp'
import { SlideOver } from '../components/SlideOver'
import { useToast } from '../components/toastContext'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Eyebrow } from '../components/ui/Eyebrow'
import { FilterChips } from '../components/ui/FilterChips'
import { ListSkeleton } from '../components/ui/ListSkeleton'
import { Notice } from '../components/ui/Notice'
import { SectionTitle } from '../components/ui/SectionTitle'
import { Stat } from '../components/ui/Stat'
import { Surface } from '../components/ui/Surface'
import { Tooltip } from '../components/ui/Tooltip'
import { addMonths, dayMonth, monthLabel, todayISO } from '../lib/dates'
import { incomeSections, incomeTotals, monthSurplus, personTotals, stateOf, type GroupBy, type SectionId } from '../lib/income'
import { useHasSidePanel } from '../lib/media'
import { formatCents } from '../lib/money'
import { usePref } from '../lib/storage'
import { useIsDesktop } from '../lib/useIsDesktop'
import { useMonthParam } from '../lib/useMonthParam'

/** A receita aberta: em leitura (detalhe) ou no formulário (editar). `scope` pré-marca "este e os seguintes". */
type Panel = { id: string; mode: 'view' | 'edit'; scope?: SeriesScope } | null

const COLLAPSED_KEY = 'prumia.receitas.secoesRecolhidas'
const GROUP_KEY = 'prumia.receitas.agrupar'

const SHORTCUTS: Shortcut[] = [
  ['N', 'nova receita'],
  ['← / →', 'mês anterior / próximo'],
  ['↑ / ↓', 'andar pela lista'],
  ['Enter', 'abrir a receita'],
  ['Esc', 'fechar'],
  ['?', 'mostrar estes atalhos'],
]

const isTyping = (el: Element | null) => Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
const rowIdOf = (el: Element | null) => (el?.closest('[data-row-id]') as HTMLElement | null)?.dataset.rowId

/**
 * Receitas do mês numa lista só. O recebimento é AUTOMÁTICO: a receita conta como recebida quando a data chega, sem
 * ninguém marcar; a exceção é "Não caiu" (e "Caiu" desfaz). No alto: o que já foi recebido, o que falta, o total por
 * pessoa e a sobra do mês (receitas − despesas). Computador: lista em colunas com seções recolhíveis e o detalhe num
 * painel fixo; o formulário abre num painel lateral de altura total. Celular: lista simples e painéis que sobem.
 */
export default function IncomesPage() {
  const { session } = useAuth()
  const [month, setMonth] = useMonthParam()
  const [panel, setPanel] = useState<Panel>(null)
  const [creating, setCreating] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [collapsed, setCollapsed] = usePref<SectionId[]>(COLLAPSED_KEY, [])
  const [groupBy, setGroupBy] = usePref<GroupBy>(GROUP_KEY, 'state')
  const toast = useToast()
  const desktop = useIsDesktop()
  const sidePanel = useHasSidePanel() && desktop
  const [params] = useSearchParams()
  const search = params.get('mes') ? `?mes=${params.get('mes')}` : ''
  const today = todayISO()

  const me = session.status === 'authenticated' ? session.me : undefined
  const { house } = useActiveHouse()
  const houseId = house?.id ?? ''

  const incomes = useIncomes(houseId, month)
  const sources = useIncomeSources(houseId)
  const members = useMembers(houseId)
  const summary = useSummary(houseId, month)
  const actions = useIncomeActions(houseId)
  const sourceActions = useSourceActions(houseId)

  const list = useMemo(() => incomes.data ?? [], [incomes.data])
  const memberList = useMemo(() => members.data ?? [], [members.data])
  const totals = useMemo(() => incomeTotals(list), [list])
  const people = useMemo(() => personTotals(list, memberList), [list, memberList])
  const sections = useMemo(() => incomeSections(list, groupBy, memberList), [list, groupBy, memberList])
  // Ordem em que as linhas aparecem (↑/↓): por seção, sem as recolhidas.
  const order = useMemo(() => sections.filter((s) => !collapsed.includes(s.id)).flatMap((s) => s.items), [sections, collapsed])
  const panelIncome = panel ? list.find((i) => i.id === panel.id) : undefined
  const canWrite = house?.role !== 'viewer'
  const busy = actions.receive.isPending || actions.unreceive.isPending

  // ------------------------------------------------------------------ ações
  function hold(inc: Income) {
    actions.unreceive.mutate(inc.id, {
      onSuccess: () => toast({ message: `${inc.description}: não caiu.`, actionLabel: 'Desfazer', onAction: () => actions.receive.mutate(inc.id) }),
      onError: () => toast({ message: 'Não foi possível registrar. Tente de novo.' }),
    })
  }

  function receiveIt(inc: Income) {
    actions.receive.mutate(inc.id, {
      onSuccess: () => toast({ message: `${inc.description}: caiu.`, actionLabel: 'Desfazer', onAction: () => actions.unreceive.mutate(inc.id) }),
      onError: () => toast({ message: 'Não foi possível registrar. Tente de novo.' }),
    })
  }

  function remove(inc: Income, scope: SeriesScope) {
    actions.remove.mutate({ id: inc.id, scope }, {
      onSuccess: () => {
        setPanel(null)
        // Em lote, o Desfazer restaura o lote inteiro; exclusões avulsas anteriores continuam excluídas.
        const batch = scope === 'following' && inc.repeats
        toast({
          message: batch ? 'Esta e as seguintes foram excluídas.' : `${inc.description} excluída.`,
          actionLabel: 'Desfazer',
          onAction: () =>
            actions.restore.mutate(
              { id: inc.id, scope: batch ? 'following' : 'this' },
              { onError: () => toast({ message: 'Não foi possível desfazer. Restaure uma a uma.' }) },
            ),
        })
      },
      onError: () => toast({ message: 'Não foi possível excluir.' }),
    })
  }

  function endRepetition(src: IncomeSource) {
    sourceActions.update.mutate(
      { id: src.id, body: { endMonth: month } },
      {
        onSuccess: () => toast({ message: `${src.name}: repetição encerrada depois de ${monthLabel(month)}.` }),
        onError: () => toast({ message: 'Não foi possível encerrar a repetição.' }),
      },
    )
  }

  // Excluir a repetição inteira: previstos somem (logicamente), recebidos ficam. O Desfazer restaura o lote.
  function deleteRepetition(sourceId: string, name: string) {
    sourceActions.remove.mutate(sourceId, {
      onSuccess: () => {
        setPanel(null)
        toast({
          message: `${name}: repetição excluída. Os meses já recebidos ficam.`,
          actionLabel: 'Desfazer',
          onAction: () => sourceActions.restore.mutate(sourceId, { onError: () => toast({ message: 'Não foi possível desfazer. A repetição mudou depois da exclusão.' }) }),
        })
      },
      onError: () => toast({ message: 'Não foi possível excluir a repetição.' }),
    })
  }

  const openNew = () => {
    setPanel(null)
    setCreating(true)
  }

  // ------------------------------------------------------------------ atalhos (computador)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  const onShortcut = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    if (document.querySelector('[role="dialog"]')) return
    if (isTyping(document.activeElement)) return
    const focusRow = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus()
    const current = rowIdOf(document.activeElement)
    const k = e.key
    if ((k === 'n' || k === 'N') && canWrite) {
      e.preventDefault()
      openNew()
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      setMonth(addMonths(month, k === 'ArrowLeft' ? -1 : 1))
    } else if (k === '?') {
      setHelpOpen((o) => !o)
    } else if (k === 'Escape') {
      if (helpOpen) setHelpOpen(false)
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
    }
  }
  useEffect(() => {
    keys.current = onShortcut
  })
  useEffect(() => {
    if (!desktop) return
    const onKey = (e: KeyboardEvent) => keys.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [desktop])

  if (!me || !house) return null

  const surplus = summary.data ? monthSurplus(summary.data) : undefined
  const fraction = totals.expected > 0 ? totals.received / totals.expected : 0
  const hasSources = (sources.data ?? []).length > 0
  const empty = incomes.isSuccess && list.length === 0
  const personName = (id: string) => memberList.find((m) => m.userId === id)?.name ?? 'Pessoa'
  const incomeOfSource = (sourceId: string) => list.find((i) => i.sourceId === sourceId)
  const ready = members.isSuccess

  const formProps = {
    houseId, month, members: memberList, defaultUserId: me.id, canWrite,
    onCreate: (body: Parameters<typeof actions.create.mutateAsync>[0]) => actions.create.mutateAsync(body),
    onUpdate: (id: string, body: Parameters<typeof actions.update.mutateAsync>[0]['body'], scope: SeriesScope) => actions.update.mutateAsync({ id, body, scope }),
  }
  const detail = panelIncome && (
    <IncomeDetail
      income={panelIncome}
      personName={personName(panelIncome.userId)}
      today={today}
      canWrite={canWrite}
      busy={busy}
      onReceive={receiveIt}
      onHold={hold}
      onEdit={() => setPanel({ id: panelIncome.id, mode: 'edit' })}
      onDelete={remove}
      onDeleteRepetition={(inc) => inc.sourceId && deleteRepetition(inc.sourceId, inc.description)}
    />
  )
  const editForm = panelIncome && ready && (
    <IncomeForm
      key={panelIncome.id}
      {...formProps}
      income={panelIncome}
      startScope={panel?.scope}
      onDone={() => setPanel({ id: panelIncome.id, mode: 'view' })}
      onCancel={() => setPanel({ id: panelIncome.id, mode: 'view' })}
    />
  )
  const newForm = ready && <IncomeForm key="nova" {...formProps} onDone={() => setCreating(false)} />

  // Qual número é o destaque do topo: a sobra negativa (vai faltar), o que falta receber (nada caiu ainda) ou o recebido.
  const focus: 'short' | 'pending' | 'received' = surplus && surplus.surplus < 0 ? 'short' : totals.received === 0 && totals.pending > 0 ? 'pending' : 'received'
  const surplusLine = surplus && (
    <p className="text-meta text-muted">
      receitas {formatCents(surplus.income)} − despesas {formatCents(surplus.expenses)}
    </p>
  )
  const summaryLink = (
    <Link to={{ pathname: '/resumo', search }} className="mt-1 inline-flex min-h-8 items-center text-ui font-medium text-accent underline underline-offset-2">
      Ver no resumo
    </Link>
  )

  const groupSwitch = (
    <FilterChips<GroupBy>
      label="Agrupar a lista"
      value={groupBy}
      onChange={setGroupBy}
      options={[{ value: 'state', label: 'Por situação' }, { value: 'person', label: 'Por pessoa' }]}
    />
  )

  const emptyState = empty ? (
    <EmptyState
      className="mt-2"
      title={hasSources || !canWrite ? 'Nenhuma receita neste mês.' : 'Nenhuma receita cadastrada.'}
      actions={
        canWrite && (
          <Button onClick={openNew}>
            <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> {hasSources ? 'Nova receita' : 'Cadastrar salário'}
          </Button>
        )
      }
    >
      {!hasSources && canWrite && <>Cadastre o seu salário <strong>uma vez</strong> e ele se repete todo mês, no dia útil certo. Você só ajusta o que mudar.</>}
    </EmptyState>
  ) : null

  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-36 pt-2 md:max-w-[1600px] md:gap-8 md:px-8 md:pb-10 md:pt-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <MonthSelector month={month} onChange={setMonth} />
          {desktop && (
            <div className="flex flex-wrap items-center gap-2">
              {canWrite && (
                <Tooltip label="Nova receita" shortcut="N">
                  <Button onClick={openNew}>
                    <Plus size={18} strokeWidth={1.5} aria-hidden="true" /> Nova receita
                    <kbd className="ml-1 rounded-sm bg-on-structure/15 px-1 font-mono text-caption leading-4">N</kbd>
                  </Button>
                </Tooltip>
              )}
              <ShortcutsHelp open={helpOpen} onToggle={() => setHelpOpen((o) => !o)} items={SHORTCUTS} />
            </div>
          )}
        </header>

        {/* Topo: UM destaque (Surface raised) que muda com o estado do mês e, ao lado, sem caixa, o resto do contexto.
            Sobra negativa vira o destaque; sem nada recebido, o destaque é o que falta receber (nunca um "R$ 0,00" grande). */}
        <section aria-label="Resumo das receitas" className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-8">
          <Surface as="section" aria-label="Destaque das receitas" className="flex min-w-0 flex-col gap-2">
            {focus === 'short' && surplus ? (
              <>
                <Eyebrow as="h2" tone="alert">vai faltar no mês</Eyebrow>
                <p className="font-mono text-figure font-semibold tracking-tight tabular-nums text-alert-text md:text-figure-lg">
                  <span aria-hidden="true" className="mr-2 text-ui text-alert">[ ✖ ]</span>
                  {formatCents(surplus.surplus)}
                </p>
                {surplusLine}
                {summaryLink}
              </>
            ) : focus === 'pending' ? (
              <>
                <Eyebrow as="h2">a receber neste mês</Eyebrow>
                <p className="font-mono text-figure font-semibold tracking-tight tabular-nums text-heading md:text-figure-lg">{formatCents(totals.pending)}</p>
                <p className="text-ui text-muted">Nada recebido ainda.</p>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <Eyebrow as="h2">recebido</Eyebrow>
                  <span className="font-mono text-caption text-muted">{Math.round(fraction * 100)}% do mês</span>
                </div>
                <p className="font-mono text-figure font-semibold tracking-tight tabular-nums text-heading md:text-figure-lg">{formatCents(totals.received)}</p>
                <PaidGauge fraction={fraction} />
                <p className="text-ui text-muted">
                  a receber <span className="font-mono font-semibold tabular-nums text-ink">{formatCents(totals.pending)}</span>
                </p>
              </>
            )}
          </Surface>

          <div className="flex min-w-0 flex-col divide-y divide-line px-1 lg:px-0">
            {focus !== 'received' && (
              <div className="pb-4">
                <Stat label="recebido" value={formatCents(totals.received)} emphasis={totals.received === 0 ? 'muted' : 'default'} size="sm" aside={`${Math.round(fraction * 100)}%`} />
              </div>
            )}
            <div className={focus !== 'received' ? 'py-4' : 'pb-4'}>
              <Eyebrow>por pessoa</Eyebrow>
              {people.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Sem receitas neste mês.</p>
              ) : (
                <table className="mt-1 w-full text-sm">
                  <thead className="sr-only">
                    <tr><th scope="col">Pessoa</th><th scope="col">Recebido</th><th scope="col">A receber</th></tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.userId}>
                        <th scope="row" className="py-0.5 pr-2 text-left font-medium text-ink">{p.name}</th>
                        <td className="py-0.5 text-right font-mono font-semibold tabular-nums text-ink">{formatCents(p.received)}</td>
                        <td className="py-0.5 pl-3 text-right font-mono text-meta tabular-nums text-muted">
                          <span className="sr-only">a receber </span>{p.pending > 0 ? `+ ${formatCents(p.pending)}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {focus !== 'short' && (
              <div className="pt-4">
                <Eyebrow>sobra do mês</Eyebrow>
                {surplus ? (
                  <>
                    <p className="mt-1 font-mono text-title font-semibold tabular-nums text-heading">{formatCents(surplus.surplus)}</p>
                    {surplusLine}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted" role="status">{summary.isError ? 'Indisponível agora.' : 'calculando…'}</p>
                )}
                {summaryLink}
              </div>
            )}
          </div>
        </section>

        {incomes.isPending && <ListSkeleton label="Carregando as receitas" rows={4} />}
        {incomes.isError && <Notice onRetry={() => void incomes.refetch()}>Não foi possível carregar as receitas.</Notice>}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <section aria-label="Receitas do mês" className="@container min-w-0">
              {desktop ? (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <SectionTitle className="mr-auto">Receitas do mês</SectionTitle>
                  {list.length > 0 && groupSwitch}
                </div>
              ) : (
                <h2 className="sr-only">Receitas do mês</h2>
              )}
              {emptyState}
              {desktop ? (
                <IncomeSections
                  sections={sections}
                  collapsed={collapsed}
                  onToggle={(id) => setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id])}
                  members={memberList}
                  today={today}
                  selectedId={panel?.id}
                  canWrite={canWrite}
                  busy={busy}
                  onReceive={receiveIt}
                  onHold={hold}
                  onOpen={(inc) => { setCreating(false); setPanel({ id: inc.id, mode: 'view' }) }}
                />
              ) : (
                <IncomeList incomes={list} members={memberList} today={today} onOpen={(inc) => setPanel({ id: inc.id, mode: 'view' })} />
              )}
            </section>

            <RepeatingIncomes
              sources={sources.data ?? []}
              members={memberList}
              month={month}
              incomeOf={incomeOfSource}
              canWrite={canWrite}
              busy={sourceActions.update.isPending || sourceActions.remove.isPending}
              onEdit={(inc) => { setCreating(false); setPanel({ id: inc.id, mode: 'edit', scope: 'following' }) }}
              onEnd={endRepetition}
              onDelete={(src) => deleteRepetition(src.id, src.name)}
            />
          </div>

          {sidePanel && (
            <aside className="flex w-full shrink-0 flex-col gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:w-[380px] xl:overflow-y-auto 2xl:w-[440px]">
              {panelIncome ? (
                <Surface as="section" aria-label="Detalhes da receita" className="motion-safe:animate-fade-in">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <SectionTitle size="title" className="min-w-0 break-words leading-tight">{panelIncome.description}</SectionTitle>
                    <Tooltip label="Fechar" shortcut="Esc">
                      <Button variant="icon" aria-label="Fechar detalhes" onClick={() => setPanel(null)}>
                        <X size={20} strokeWidth={1.5} aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </div>
                  {detail}
                </Surface>
              ) : (
                <NextUp list={list} today={today} onOpen={(inc) => setPanel({ id: inc.id, mode: 'view' })} canWrite={canWrite} />
              )}
            </aside>
          )}
        </div>
      </main>

      {!desktop && canWrite && (
        <button
          aria-label="Nova receita"
          onClick={openNew}
          className="fixed bottom-24 right-4 z-30 flex size-14 items-center justify-center rounded-md bg-structure text-on-structure transition-colors hover:bg-structure/90 motion-safe:active:scale-95"
        >
          <Plus size={28} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {/* Lançar: painel lateral de altura total (computador) ou painel que sobe (celular). */}
      {creating && desktop && newForm && (
        <SlideOver title="Nova receita" onClose={() => setCreating(false)}>
          {newForm}
        </SlideOver>
      )}
      {creating && !desktop && newForm && (
        <Sheet title="Nova receita" onClose={() => setCreating(false)}>
          {newForm}
        </Sheet>
      )}

      {/* Editar: sempre num painel lateral (computador) ou no Sheet (celular). */}
      {panelIncome && panel?.mode === 'edit' && editForm && desktop && (
        <SlideOver title="Editar receita" onClose={() => setPanel({ id: panelIncome.id, mode: 'view' })}>
          {editForm}
        </SlideOver>
      )}
      {panelIncome && panel?.mode === 'edit' && editForm && !desktop && (
        <Sheet title="Editar receita" onClose={() => setPanel({ id: panelIncome.id, mode: 'view' })}>
          {editForm}
        </Sheet>
      )}

      {/* Detalhe: computador estreito (sem painel fixo) usa o painel lateral; celular, o Sheet. */}
      {panelIncome && panel?.mode === 'view' && desktop && !sidePanel && (
        <SlideOver title="Detalhes da receita" onClose={() => setPanel(null)}>
          <SectionTitle as="h3" size="title" className="mb-3">{panelIncome.description}</SectionTitle>
          {detail}
        </SlideOver>
      )}
      {panelIncome && panel?.mode === 'view' && !desktop && (
        <Sheet title="Detalhes da receita" onClose={() => setPanel(null)}>
          <SectionTitle as="h3" size="title" className="mb-3">{panelIncome.description}</SectionTitle>
          {detail}
        </Sheet>
      )}
    </AppShell>
  )
}

/** O painel ao lado da lista quando nenhuma receita está aberta: as próximas a cair neste mês e a dica de atalhos (sem caixa). */
function NextUp({ list, today, onOpen, canWrite }: { list: Income[]; today: string; onOpen: (inc: Income) => void; canWrite: boolean }) {
  const items = list.filter((i) => stateOf(i) !== 'received').slice(0, 8)
  return (
    <section aria-label="Próximas a receber" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow as="h2">a receber neste mês</Eyebrow>
        {items.length > 0 && <span className="font-mono text-ui font-semibold tabular-nums text-ink">{formatCents(items.reduce((s, i) => s + i.netAmountCents, 0))}</span>}
      </div>
      <span aria-hidden="true" className="h-px bg-line" />
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span>
          Tudo o que estava previsto já caiu.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {items.map((i) => (
            <li key={i.id}>
              <button onClick={() => onOpen(i)} className="flex min-h-9 w-full items-center gap-3 rounded-sm px-2 text-left text-sm transition-colors hover:bg-raised">
                <span aria-hidden="true" className={`font-mono text-caption ${stateOf(i) === 'held' ? 'text-alert' : 'text-muted'}`}>{stateOf(i) === 'held' ? '[ ✖ ]' : '[ ▫ ]'}</span>
                <span className="w-11 font-mono text-meta tabular-nums text-muted">{dayMonth(i.expectedDate)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{i.description}</span>
                <span className="font-mono text-ui font-semibold tabular-nums text-ink">{formatCents(i.netAmountCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-meta text-muted">
        Selecione uma receita para ver os detalhes.{canWrite && <> Nova receita: tecla <kbd className="font-mono">N</kbd>.</>} Hoje é {dayMonth(today)}.
      </p>
    </section>
  )
}
