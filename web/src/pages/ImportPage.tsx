import { useNavigate } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { ImportFlow } from '../components/ImportFlow'

/** Rota `/importar` (celular e link direto): a mesma importação do modal do computador, em tela cheia. */
export default function ImportPage() {
  const navigate = useNavigate()
  return (
    <AppShell>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-36 pt-2 md:max-w-none md:gap-6 md:px-10 md:pb-10 md:pt-8">
        <header>
          <h1 className="font-display text-3xl font-semibold font-stretch-condensed text-heading">Importar contas</h1>
          <p className="mt-1 text-sm text-ink/75">
            Boleto, conta sem código de barras, print de uma lista ou texto colado. Uma conta por linha: <strong>descrição: valor</strong>. Você
            confere tudo antes de criar.
          </p>
        </header>
        <ImportFlow onCreated={(month) => navigate(`/?mes=${month}`)} />
      </main>
    </AppShell>
  )
}
