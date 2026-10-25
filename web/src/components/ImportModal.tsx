import { Panel } from './ui/Panel'
import { ImportFlow } from './ImportFlow'

type Props = { month: string; onClose: () => void; onCreated: () => void; onView: (month: string) => void }

/** Importação em massa no computador: janela larga sobre o mês (no celular continua a página `/importar`). */
export default function ImportModal({ month, onClose, onCreated, onView }: Props) {
  return (
    <Panel variant="wide" title="Importar contas" subtitle="Você confere tudo antes de criar." onClose={onClose}>
      <ImportFlow month={month} onCreated={onCreated} onView={onView} />
    </Panel>
  )
}
