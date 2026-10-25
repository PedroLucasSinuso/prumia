import { useNavigate } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { ImportFlow } from '../components/ImportFlow'
import { SectionTitle } from '../components/ui/SectionTitle'

/** Rota `/importar` (celular e link direto): a mesma importação do modal do computador, em tela cheia. */
export default function ImportPage() {
  const navigate = useNavigate()
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-36 pt-2 md:max-w-none md:gap-6 md:px-10 md:pb-10 md:pt-8">
        <header>
          <SectionTitle as="h1" size="page" className="leading-none">Importar contas</SectionTitle>
          <p className="mt-2 max-w-prose text-sm text-muted">
            Boleto, conta sem código de barras, print de uma lista ou texto colado. Uma conta por linha: <strong>descrição: valor</strong>. Você
            confere tudo antes de criar.
          </p>
        </header>
        <ImportFlow onCreated={(month) => navigate(`/?mes=${month}`)} />
      </main>
    </AppShell>
  )
}
