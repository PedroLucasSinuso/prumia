import { Download } from 'lucide-react'
import { useState } from 'react'

import { networkErrorMessage } from '../../auth/errors'
import { useActiveHouse } from '../../auth/useActiveHouse'
import { ICON } from '../../lib/navigation'
import { Button } from '../ui/Button'
import { Field } from '../Field'
import { Card, SectionHeader } from './ui'

/**
 * Ajustes > Dados: exporta as contas da casa em CSV (abre direto no Excel/Planilhas).
 * Quem só lê (viewer) também pode exportar. O arquivo vem do servidor; aqui só pedimos e entregamos o download.
 * `fetch` direto (e não o cliente tipado) porque a resposta é um arquivo, não JSON.
 */
export function DataSection() {
  const { house } = useActiveHouse()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  if (!house) return null
  const houseId = house.id

  async function download() {
    setBusy(true)
    setError(undefined)
    try {
      const q = new URLSearchParams()
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const qs = q.toString()
      const res = await fetch(`/api/households/${houseId}/export/invoices.csv${qs ? `?${qs}` : ''}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = 'prumia-contas.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError(`Não foi possível exportar. ${networkErrorMessage}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SectionHeader title="Dados" description="Leve suas contas para uma planilha. Os dados continuam sendo seus." />
      <Card label="Exportar contas" title="Exportar contas (CSV)" className="max-w-xl">
        <p className="mt-2 text-sm text-muted">Vencimento, categoria, favorecido, valor, status e pagamento, uma conta por linha. Deixe as datas em branco para exportar tudo.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Vencimento de" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="Vencimento até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm">
            <span className="font-mono text-alert">[ ✖ ]</span> {error}
          </p>
        )}
        <Button className="mt-4 inline-flex items-center gap-2" onClick={() => void download()} disabled={busy}>
          <Download aria-hidden="true" size={ICON.size - 2} strokeWidth={ICON.strokeWidth} />
          {busy ? 'Gerando…' : 'Baixar CSV'}
        </Button>
      </Card>
    </div>
  )
}
