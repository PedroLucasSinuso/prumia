import { Button } from './Button'

/**
 * Confirmação de "Excluir a repetição" (usada na lista de repetições e no detalhe da receita). Explica o efeito em palavras:
 * os meses já recebidos ficam no histórico e os próximos (previstos) somem. Depois de confirmar, a tela mostra o Desfazer.
 */
export function DeleteRepetitionConfirm({ name, busy, onConfirm, onCancel }: { name: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div role="group" aria-label={`Excluir ${name}`} className="flex w-full flex-col gap-2 rounded-md bg-alert/10 px-3 py-2 text-sm">
      <p>Excluir &quot;{name}&quot;? Os meses já recebidos ficam; os próximos somem.</p>
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={onConfirm} className="md:h-9">
          Excluir a repetição
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="md:h-9">
          Cancelar
        </Button>
      </div>
    </div>
  )
}
