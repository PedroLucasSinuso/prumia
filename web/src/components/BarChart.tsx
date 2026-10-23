import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

import { formatCompact, monthShort, niceMax, type Stack } from '../lib/history'
import { formatCents } from '../lib/money'

type Props = {
  stack: Stack
  /** Nome do gráfico para leitores de tela (ex.: "Gasto com Moradia por mês"). */
  label: string
  height?: number
}

const PAD = { top: 12, right: 8, bottom: 22, left: 56 }

/**
 * Barras por mês em SVG próprio (sem biblioteca). Cada barra empilha as fatias (`stack.segments`, cor por fatia, sempre na
 * mesma ordem); dentro de cada fatia, o PAGO é sólido e o A PAGAR é tracejado com contorno (sem gradiente).
 *
 * Acessibilidade: o SVG é `role="img"` com um resumo; o valor exato de cada mês aparece ao passar o mouse, ao focar o
 * gráfico e andar com as setas, e numa tabela só para leitores de tela.
 * Responsivo: mede a largura do contêiner (ResizeObserver) e redesenha; o texto não estica.
 */
export function BarChart({ stack, label, height = 200 }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(480)
  const [active, setActive] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { bars, segments } = stack
  const max = niceMax(Math.max(0, ...bars.map((b) => b.totalCents)))
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const slot = bars.length ? plotW / bars.length : plotW
  const barW = Math.max(6, Math.min(40, slot * 0.6))
  const y = (cents: number) => (cents / max) * plotH
  const ticks = [0, max / 2, max]
  const tone = new Map(segments.map((s) => [s.key, s.tone]))
  const name = new Map(segments.map((s) => [s.key, s.name]))

  const onKey = (e: KeyboardEvent) => {
    if (!bars.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      setActive((i) => (i === null ? (step > 0 ? 0 : bars.length - 1) : Math.min(bars.length - 1, Math.max(0, i + step))))
    } else if (e.key === 'Home') setActive(0)
    else if (e.key === 'End') setActive(bars.length - 1)
    else if (e.key === 'Escape') setActive(null)
  }

  const current = active !== null ? bars[active] : undefined
  const summary = `${label}: ${bars.map((b) => `${monthShort(b.month)} ${formatCents(b.totalCents)}`).join('; ')}`

  return (
    <div ref={box} className="relative w-full">
      {/* Foco: o grupo inteiro recebe Tab; as setas escolhem o mês e o valor aparece na dica (aria-live). */}
      <div
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use as setas para ver cada mês.`}
        onKeyDown={onKey}
        onFocus={() => setActive((i) => i ?? bars.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="rounded-sm"
      >
        <svg role="img" aria-label={summary} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-full">
          <defs>
            {segments.map((s) => (
              // Padrão "a pagar": listras finas a 45° na cor da fatia, sobre um véu leve da mesma cor.
              <pattern key={s.key} id={`p-${uid}-${s.key}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" className={s.tone.fill} opacity="0.15" />
                <line x1="0" y1="0" x2="0" y2="5" className={s.tone.stroke} strokeWidth="2" />
              </pattern>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t} className="text-ink">
              <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH - y(t)} y2={PAD.top + plotH - y(t)} stroke="currentColor" strokeOpacity={t === 0 ? 0.35 : 0.12} />
              <text x={PAD.left - 6} y={PAD.top + plotH - y(t)} dy="0.32em" textAnchor="end" fill="currentColor" fillOpacity="0.7" className="font-mono text-[10px] tabular-nums">
                {formatCompact(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const cx = PAD.left + slot * i + slot / 2
            let base = PAD.top + plotH
            const rects = []
            for (const p of b.parts) {
              const t = tone.get(p.key) ?? { fill: 'fill-ink/20', stroke: 'stroke-ink/30' }
              if (p.paidCents > 0) {
                const h = y(p.paidCents)
                base -= h
                rects.push(<rect key={`${p.key}-p`} x={cx - barW / 2} y={base} width={barW} height={Math.max(0, h - 1)} className={t.fill} />)
              }
              if (p.pendingCents > 0) {
                const h = y(p.pendingCents)
                base -= h
                rects.push(
                  <rect key={`${p.key}-a`} x={cx - barW / 2 + 0.5} y={base + 0.5} width={barW - 1} height={Math.max(0, h - 2)} fill={`url(#p-${uid}-${p.key})`} strokeWidth="1" className={t.stroke} />,
                )
              }
            }
            return (
              <g key={b.month} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
                {/* alvo do mouse maior que a barra: a coluna inteira */}
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                {active === i && <rect x={PAD.left + slot * i + 2} y={PAD.top} width={slot - 4} height={plotH} fill="currentColor" className="text-ink/5" />}
                {rects}
                <text x={cx} y={height - 6} textAnchor="middle" fill="currentColor" className={`font-mono text-[10px] ${active === i ? 'text-ink' : 'text-ink/70'}`}>
                  {monthShort(b.month)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <p aria-live="polite" className="mt-1 min-h-5 text-xs text-ink/80">
        {current ? (
          <>
            <span className="font-medium">{monthShort(current.month)}</span>{' '}
            <span className="font-mono tabular-nums">{formatCents(current.totalCents)}</span>
            {current.totalCents > current.paidCents && (
              <span className="text-ink/70">
                {' '}· pago <span className="font-mono tabular-nums">{formatCents(current.paidCents)}</span> · a pagar{' '}
                <span className="font-mono tabular-nums">{formatCents(current.totalCents - current.paidCents)}</span>
              </span>
            )}
            {segments.length > 1 &&
              current.parts
                .filter((p) => p.paidCents + p.pendingCents > 0)
                .map((p) => (
                  <span key={p.key} className="text-ink/70">
                    {' '}· {name.get(p.key)} <span className="font-mono tabular-nums">{formatCents(p.paidCents + p.pendingCents)}</span>
                  </span>
                ))}
          </>
        ) : (
          <span className="text-ink/60">Selecione um mês (ou use as setas) para ver o valor exato.</span>
        )}
      </p>

      <ul aria-label="Legenda" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/80">
        {segments.length > 1 &&
          segments.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <svg aria-hidden="true" width="10" height="10">
                <rect width="10" height="10" rx="2" className={s.tone.fill} />
              </svg>
              {s.name}
            </li>
          ))}
        <li className="flex items-center gap-1.5 text-ink/70">
          <svg aria-hidden="true" width="10" height="10" className="text-ink/70">
            <rect width="10" height="10" rx="2" fill="currentColor" />
          </svg>
          pago
        </li>
        <li className="flex items-center gap-1.5 text-ink/70">
          <svg aria-hidden="true" width="10" height="10" className="text-ink/70">
            <defs>
              <pattern id={`lg-${uid}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.5" />
              </pattern>
            </defs>
            <rect x="0.5" y="0.5" width="9" height="9" rx="2" fill={`url(#lg-${uid})`} stroke="currentColor" />
          </svg>
          a pagar
        </li>
      </ul>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">mês</th>
            <th scope="col">total</th>
            <th scope="col">pago</th>
            <th scope="col">a pagar</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b) => (
            <tr key={b.month}>
              <th scope="row">{monthShort(b.month)}</th>
              <td>{formatCents(b.totalCents)}</td>
              <td>{formatCents(b.paidCents)}</td>
              <td>{formatCents(b.totalCents - b.paidCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
