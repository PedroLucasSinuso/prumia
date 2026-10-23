import { copyText } from '../lib/links'
import { useToast } from './toastContext'
import { Button } from './Button'

/** Mostra um link já gerado (somente leitura, selecionável) com botão de copiar. */
export function LinkBox({ label, link, note }: { label: string; link: string; note?: string }) {
  const toast = useToast()
  return (
    <div className="rounded-md border-2 border-structure p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-ink/70">{label}</p>
      <input
        readOnly
        aria-label={label}
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-1 h-11 w-full rounded-md border border-ink/25 bg-white/40 px-3 font-mono text-xs"
      />
      {note && <p className="mt-1 text-xs text-ink/70">{note}</p>}
      <Button
        className="mt-2"
        onClick={async () => toast({ message: (await copyText(link)) ? 'Link copiado.' : 'Não deu para copiar. Selecione o link e copie.' })}
      >
        Copiar link
      </Button>
    </div>
  )
}
