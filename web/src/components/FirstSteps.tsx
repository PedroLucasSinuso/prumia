import { Link } from 'react-router-dom'

import { useIncomeSources, useMembers } from '../api/queries'
import { usePref } from '../lib/storage'
import { Surface } from './ui/Surface'

/** Guia "Instalar no celular" no site público (fora do app). */
const INSTALL_GUIDE = 'https://prumia.pages.dev/guias/instalar-no-celular/'

type Props = {
  houseId: string
  /** O mês aberto já tem alguma conta (a lista da tela do Mês). */
  hasInvoices: boolean
  onNewInvoice: () => void
}

const installed = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(display-mode: standalone)').matches)

/**
 * Onboarding na tela do Mês: os primeiros passos de uma casa nova, cada um marcado sozinho a partir dos dados (fonte de
 * receita cadastrada, alguma conta lançada, mais de uma pessoa na casa). "Conferir as carteiras" e "Instalar no celular"
 * contam ao tocar. O cartão some quando tudo está feito ou quando a pessoa dispensa (lembrado neste aparelho, por casa).
 * Só aparece para quem escreve (Só leitura não tem o que fazer aqui).
 */
export function FirstSteps({ houseId, hasInvoices, onNewInvoice }: Props) {
  const sources = useIncomeSources(houseId)
  const members = useMembers(houseId)
  const [seen, setSeen] = usePref<Record<string, boolean>>(`prumia.primeiros-passos.${houseId}`, {})
  if (seen.dispensado || !sources.isSuccess || !members.isSuccess) return null

  const mark = (k: string) => setSeen({ ...seen, [k]: true })
  const steps = [
    { key: 'salario', done: sources.data.length > 0, label: 'Cadastre o salário (ou outra receita que se repete)', to: '/receitas' },
    { key: 'conta', done: hasInvoices, label: 'Lance a primeira conta do mês', action: onNewInvoice },
    { key: 'carteiras', done: Boolean(seen.carteiras), label: 'Confira as carteiras (Geral, Benefício...)', to: '/ajustes/carteiras' },
    { key: 'celular', done: Boolean(seen.celular) || installed(), label: 'Instale o prumia no celular', href: INSTALL_GUIDE },
    { key: 'convidar', done: members.data.length > 1, label: 'Convide quem mora com você', to: '/ajustes/casa' },
  ]
  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null

  const item = 'font-medium text-accent underline underline-offset-2'
  return (
    <Surface as="section" aria-label="Primeiros passos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-meta font-medium uppercase tracking-wider text-muted">primeiros passos</h2>
        <span className="font-mono text-meta tabular-nums text-muted">
          {doneCount} de {steps.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-ui">
            <span aria-hidden="true" className={`font-mono ${s.done ? 'text-accent' : 'text-muted'}`}>
              {s.done ? '[ ▪ ]' : '[ ▫ ]'}
            </span>
            {s.done ? (
              <span className="text-muted line-through">
                {s.label}
                <span className="sr-only"> (feito)</span>
              </span>
            ) : s.action ? (
              <button type="button" className={item} onClick={s.action}>
                {s.label}
              </button>
            ) : s.href ? (
              <a href={s.href} target="_blank" rel="noreferrer" className={item} onClick={() => mark(s.key)}>
                {s.label}
              </a>
            ) : (
              <Link to={s.to!} className={item} onClick={() => mark(s.key)}>
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <div>
        <button type="button" className="text-meta text-muted underline underline-offset-2" onClick={() => mark('dispensado')}>
          Dispensar
        </button>
      </div>
    </Surface>
  )
}
