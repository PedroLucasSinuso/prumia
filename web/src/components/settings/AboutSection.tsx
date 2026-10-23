import { Card, SectionHeader } from './ui'

// Vem do package.json, embutido no build pelo Vite (`define` em vite.config.ts). Nos testes, cai em 'dev'.
const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

const GUIDES_URL = 'https://github.com/PedroLucasSinuso/prumia/blob/main/docs/user-guides/'
const guides = [
  { label: 'Primeiros passos', file: 'primeiros-passos.md' },
  { label: 'Cadastrar e pagar contas', file: 'cadastrar-e-pagar-contas.md' },
  { label: 'Categorias e ajustes', file: 'categorias-e-ajustes.md' },
  { label: 'Convidar pessoas', file: 'convidar-pessoas.md' },
  { label: 'Fazer backup', file: 'fazer-backup.md' },
]

/** Ajustes > Sobre: versão e atalhos para os guias de uso. */
export function AboutSection() {
  return (
    <div>
      <SectionHeader title="Sobre" description="prumia · Clareza para construir o futuro." />
      <Card label="Versão" className="max-w-xl">
        <p className="text-sm">
          Versão <span className="font-mono tabular-nums">{version}</span>
        </p>
      </Card>
      <Card label="Guias" title="Guias de uso" className="mt-4 max-w-xl">
        <ul className="mt-2 flex flex-col">
          {guides.map((g) => (
            <li key={g.file} className="border-t border-line first:border-t-0">
              <a href={GUIDES_URL + g.file} target="_blank" rel="noreferrer" className="flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4">
                {g.label}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
