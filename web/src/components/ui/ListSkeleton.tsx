/**
 * Carregamento de uma lista ou bloco: linhas neutras (`bg-ink/8`) no lugar do "carregando…" em texto. Pulsa só com
 * `motion-safe` (quem pediu menos movimento vê as linhas paradas). `role="status"` + texto escondido para leitores de tela.
 * Uso: `{q.isPending && <ListSkeleton label="Carregando as contas" />}`; `rows` muda a quantidade, `dense` a altura.
 */
export function ListSkeleton({ label = 'Carregando…', rows = 3, dense = false, className = '' }: { label?: string; rows?: number; dense?: boolean; className?: string }) {
  return (
    <div role="status" aria-label={label} className={`flex flex-col gap-2 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          // a última linha mais curta: parece texto, não uma grade
          className={`block rounded-sm bg-ink/8 motion-safe:animate-pulse ${dense ? 'h-4' : 'h-10'} ${i === rows - 1 && rows > 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  )
}
