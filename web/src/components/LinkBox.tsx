import { copyText } from '../lib/links'
import { useToast } from './toastContext'
import { Button } from './ui/Button'
import { Eyebrow } from './ui/Eyebrow'
import { Surface } from './ui/Surface'

/** Mostra um link já gerado (somente leitura, selecionável) com botão de copiar. */
export function LinkBox({ label, link, note }: { label: string; link: string; note?: string }) {
  const toast = useToast()
  return (
    <Surface pad="sm">
      <Eyebrow>{label}</Eyebrow>
      <input
        readOnly
        aria-label={label}
        value={link}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-1 h-11 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-meta"
      />
      {note && <p className="mt-1 text-meta text-muted">{note}</p>}
      <Button
        className="mt-2"
        onClick={async () => toast({ message: (await copyText(link)) ? 'Link copiado.' : 'Não deu para copiar. Selecione o link e copie.' })}
      >
        Copiar link
      </Button>
    </div>
  )
}
