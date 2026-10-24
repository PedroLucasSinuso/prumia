import { Panel } from './ui/Panel'
import { ImportFlow } from './ImportFlow'

/** Importação em massa no computador: janela larga sobre o mês (no celular continua a página `/importar`). */
export default function ImportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (month: string) => void }) {
  return (
    <Panel variant="wide" title="Importar contas" subtitle="Você confere tudo antes de criar." onClose={onClose}>
      <ImportFlow onCreated={onCreated} />
    </Panel>
  )
}
