import { ChevronDown, Plus } from 'lucide-react'
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { Popover } from './Popover'
import { controlCls, labelCls } from './styles'

export type ComboOption = {
  value: string
  /** Texto principal ("Gás"). */
  label: string
  /** Grupo/mãe ("Moradia"): a opção aparece como "Moradia › Gás", recuada, logo abaixo da própria mãe. */
  group?: string
  /** Selo mono à direita (ex.: "VR"). */
  badge?: string
  /** Descrição do selo para leitores de tela e dica. */
  badgeTitle?: string
}

type Props = {
  label: string
  /** Rótulo só para leitores de tela (o campo já tem outro texto perto). */
  hideLabel?: boolean
  options: ComboOption[]
  /** `value` escolhido ('' = nada). */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Texto da opção que limpa a escolha ("nenhuma"); sem ele, não há opção vazia. */
  emptyLabel?: string
  /** Item sempre visível no fim da lista ("Nova categoria…"). Recebe o texto digitado. */
  onCreate?: (typed: string) => void
  createLabel?: string
  error?: string
  hint?: string
  disabled?: boolean
  id?: string
  className?: string
}

/** Minúsculas e sem acento: "Educação" casa com "educacao". */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const fullLabel = (o: ComboOption) => (o.group ? `${o.group} › ${o.label}` : o.label)
/** Texto usado na busca: "Moradia Gás" (o separador › não conta, para "moradia gas" achar "Moradia › Gás"). */
const searchText = (o: ComboOption) => norm(`${o.group ?? ''} ${o.label}`)

type Item = { kind: 'option'; opt: ComboOption } | { kind: 'empty' } | { kind: 'create' }

/**
 * Lista pesquisável (padrão ARIA "combobox com lista"): digite para filtrar, ↑/↓ movem, Enter escolhe, Esc fecha.
 *
 * - O foco fica sempre no campo; a opção ativa é anunciada por `aria-activedescendant`.
 * - Filtra ignorando acentos e caixa, pelo nome completo ("moradia gas" acha "Moradia › Gás"). Ao filtrar, uma filha
 *   cuja mãe combina continua visível junto da mãe.
 * - `group` agrupa: a filha aparece como "Moradia › Gás", logo depois da mãe. A ordem das `options` é a ordem da lista.
 * - `onCreate` mostra "+ Nova …" sempre no fim (com o texto digitado, se houver); `emptyLabel` mostra a opção "nenhuma".
 * - Enter com a lista fechada NÃO é interceptado: o formulário envia normalmente ("valor → descrição → Enter").
 * - Esc com a lista aberta só fecha a lista (não o painel em volta).
 *
 * Uso: `<Combobox label="Categoria" options={opts} value={id} onChange={setId} onCreate={() => abrirNova()} createLabel="Nova categoria" />`.
 */
export function Combobox({ label, hideLabel, options, value, onChange, placeholder, emptyLabel, onCreate, createLabel = 'Novo item', error, hint, disabled, id, className = '' }: Props) {
  const auto = useId()
  const inputId = id ?? auto
  const listId = `${inputId}-lista`
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = options.find((o) => o.value === value)
  const q = norm(query.trim().replace(/›/g, ' ')).replace(/\s+/g, ' ').trim()

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    if (emptyLabel && !q) out.push({ kind: 'empty' })
    // mãe que combina arrasta as filhas; filha que combina aparece sozinha
    const motherMatches = new Set(options.filter((o) => !o.group && norm(o.label).includes(q)).map((o) => o.label))
    for (const opt of options) {
      if (!q || searchText(opt).includes(q) || (opt.group && motherMatches.has(opt.group))) out.push({ kind: 'option', opt })
    }
    if (onCreate) out.push({ kind: 'create' })
    return out
  }, [options, q, emptyLabel, onCreate])

  const optionId = (i: number) => `${inputId}-op-${i}`
  const safeActive = Math.min(active, items.length - 1)

  function openList() {
    if (disabled || open) return
    setOpen(true)
    // começa na opção atual
    const at = items.findIndex((it) => it.kind === 'option' && it.opt.value === value)
    setActive(at >= 0 ? at : 0)
  }
  function close() {
    setOpen(false)
    setQuery('')
  }
  function choose(it: Item | undefined) {
    if (!it) return
    if (it.kind === 'create') {
      const typed = query.trim()
      close()
      onCreate?.(typed)
      return
    }
    onChange(it.kind === 'empty' ? '' : it.opt.value)
    close()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (!open) return openList()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((safeActive + step + items.length) % items.length)
        break
      }
      case 'Home':
      case 'End':
        if (!open) return
        e.preventDefault()
        setActive(e.key === 'Home' ? 0 : items.length - 1)
        break
      case 'Enter':
        if (!open) return // lista fechada: deixa o formulário enviar
        e.preventDefault()
        choose(items[safeActive])
        break
      case 'Escape':
        if (!open) return // fechada: o Esc segue para o painel
        e.preventDefault()
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        close()
        break
      case 'Tab':
        if (open) close()
        break
    }
  }

  const describedBy = [error ? `${inputId}-erro` : null, hint ? `${inputId}-dica` : null].filter(Boolean).join(' ')

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={inputId} className={hideLabel ? 'sr-only' : labelCls}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={input}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items.length > 0 ? optionId(safeActive) : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={open && selected ? fullLabel(selected) : placeholder}
          value={open ? query : selected ? fullLabel(selected) : ''}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            if (!open) setOpen(true)
          }}
          onClick={openList}
          onKeyDown={onKeyDown}
          onBlur={close}
          className={`${controlCls(Boolean(error))} pr-9`}
        />
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink/60" />
      </div>
      <Popover open={open} anchorRef={input} onClose={close} matchWidth trapEscape={false} className="max-h-72 py-1">
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          // mantém o foco no campo ao clicar numa opção
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((it, i) => {
            const on = i === safeActive
            const base = `flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm md:min-h-8 ${on ? 'bg-accent/15' : ''}`
            if (it.kind === 'create') {
              return (
                <li key="criar" id={optionId(i)} role="option" aria-selected={false} onMouseMove={() => setActive(i)} onClick={() => choose(it)} className={`${base} mt-1 border-t border-line font-medium text-accent`}>
                  <span className="flex items-center gap-1.5">
                    <Plus aria-hidden="true" size={15} strokeWidth={1.5} />
                    {query.trim() ? `${createLabel} “${query.trim()}”` : createLabel}
                  </span>
                </li>
              )
            }
            if (it.kind === 'empty') {
              return (
                <li key="vazio" id={optionId(i)} role="option" aria-selected={value === ''} onMouseMove={() => setActive(i)} onClick={() => choose(it)} className={`${base} text-ink/70`}>
                  {emptyLabel}
                </li>
              )
            }
            const o = it.opt
            return (
              <li key={o.value} id={optionId(i)} role="option" aria-label={`${fullLabel(o)}${o.badge ? `, ${o.badgeTitle ?? o.badge}` : ''}`} aria-selected={o.value === value} onMouseMove={() => setActive(i)} onClick={() => choose(it)} className={`${base} ${o.group ? 'pl-6' : ''} ${o.value === value ? 'font-semibold' : ''}`}>
                <span className="min-w-0 truncate">
                  {o.group && <span className="text-ink/60">{o.group} › </span>}
                  {o.label}
                </span>
                {o.badge && (
                  <span className="shrink-0 rounded-xs border border-ink/50 px-1 font-mono text-[10px]" title={o.badgeTitle}>
                    {o.badge}
                  </span>
                )}
              </li>
            )
          })}
          {items.length === (onCreate ? 1 : 0) && <li role="presentation" className="px-3 py-2 text-sm text-ink/70">Nada encontrado.</li>}
        </ul>
      </Popover>
      {hint && !error && (
        <p id={`${inputId}-dica`} className="text-xs text-ink/70">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-erro`} className="text-xs text-alert">
          {error}
        </p>
      )}
    </div>
  )
}
