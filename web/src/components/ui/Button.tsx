import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

import { Spinner } from './Spinner'
import { buttonCls, type ButtonSize, type ButtonVariant } from './styles'

type Common = {
  size?: ButtonSize
  /** Operação em andamento: desabilita, mostra o spinner e troca o texto por `loadingLabel`. */
  loading?: boolean
  /** Texto enquanto carrega (padrão "Salvando…"). */
  loadingLabel?: string
}
// `icon` não tem texto visível: o TypeScript EXIGE o `aria-label` (o nome que o leitor de tela lê).
// O `|` é uma "união": ou é uma variante com texto, ou é `icon` com aria-label. Em PHP seria validar o array de opções;
// aqui o erro aparece já no editor.
type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  Common &
  ({ variant?: Exclude<ButtonVariant, 'icon'> } | { variant: 'icon'; 'aria-label': string })

/**
 * Botão da marca: raio de 6px (nunca pílula). Celular: 44px de altura (alvo de toque); computador: 36px (`sm`: 32px).
 * Variantes: `primary` (structure, a ação principal), `secondary` (contorno), `quiet` (só texto), `danger` (destrutiva)
 * e `icon` (quadrado, com `aria-label`). Estados: hover, active (afunda 1% com `motion-safe`), foco visível (global),
 * disabled e `loading`. Conflito de classe se resolve com `size`/`variant`, não sobrescrevendo a altura por `className`
 * (use `className` só para margem e largura, como `w-full`).
 * Uso: `<Button loading={busy} loadingLabel="Criando…">Criar</Button>`, `<Button variant="icon" aria-label="Fechar"><X /></Button>`.
 */
export function Button({ variant = 'primary', size = 'md', loading, loadingLabel = 'Salvando…', className = '', children, disabled, ...props }: Props) {
  return (
    <button className={buttonCls({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? (
        <>
          <Spinner />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}

type LinkButtonProps = LinkProps & AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Exclude<ButtonVariant, 'icon'>; size?: ButtonSize; children: ReactNode }

/** Um <Link> do react-router com o visual do `Button` (navegar, não agir: "Importar", "Ver parcelas"). */
export function ButtonLink({ variant = 'secondary', size = 'md', className = '', ...props }: LinkButtonProps) {
  return <Link className={buttonCls({ variant, size, className })} {...props} />
}
