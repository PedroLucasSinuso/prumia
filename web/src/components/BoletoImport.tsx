import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '../api/errors'
import type { DocumentExtraction, DocumentItem } from '../api/types'
import { boletoErrorMessage, networkErrorMessage } from '../auth/errors'
import { MAX_BOLETO_BYTES } from '../lib/boleto'
import { formatCents } from '../lib/money'
import { BoletoBox } from './BoletoBox'
import { Button } from './ui/Button'
import { Field } from './Field'
import { FormError } from './FormError'

type Step =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'done'; extraction: DocumentExtraction; fileName: string }

type Props = {
  /** Envia o arquivo (e a senha, se houver) para o servidor ler (POST /documents/extract). Rejeita com ApiError. */
  onExtract: (file: File, password?: string) => Promise<DocumentExtraction>
  /** Leitura de UMA conta (boleto ou conta sem boleto): o formulário se pré-preenche com o item. Lista não chama. */
  onExtracted: (item: DocumentItem) => void
  /** Começou outra leitura ou desistiu: o boleto anterior não vale mais (os campos já preenchidos ficam). */
  onDiscard: () => void
  /** A pessoa desistiu da leitura e vai digitar. */
  onManual: () => void
  /** Abre a conta que já tem este boleto (aviso de duplicidade). */
  onOpenInvoice?: (id: string) => void
}

const link = 'flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4'

/**
 * "Importar boleto": escolher arquivo -> lendo… -> (senha do PDF, se pedir) -> conferir antes de salvar.
 * Nada é salvo aqui: só pré-preenche o formulário. O arquivo fica num ref (memória do navegador) só enquanto pode ser
 * reenviado (senha, falha de rede); a senha nunca vai para o estado do React: é lida do campo no envio e o campo é limpo.
 */
export function BoletoImport({ onExtract, onExtracted, onDiscard, onManual, onOpenInvoice }: Props) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [showDuplicate, setShowDuplicate] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const file = useRef<File | null>(null)

  const pick = () => fileInput.current?.click()

  async function read(password?: string) {
    const current = file.current
    if (!current) return pick()
    setStep({ kind: 'reading' })
    try {
      const extraction = await onExtract(current, password)
      file.current = null
      setShowDuplicate(true)
      setStep({ kind: 'done', extraction, fileName: current.name })
      // Lista (várias contas): não cabe num formulário de uma conta; a revisão oferece abrir em "Importar".
      if (extraction.kind !== 'list') onExtracted(extraction.items[0])
    } catch (err) {
      const api = err instanceof ApiError ? err : undefined
      const code = api?.problem?.code
      if (code === 'password_required' || code === 'wrong_password') {
        setStep({ kind: 'password', wrong: code === 'wrong_password' })
        return
      }
      // Rede, excesso de tentativas ou servidor ocupado: o mesmo arquivo pode dar certo depois. Nos demais casos, escolher outro.
      if (!api?.network && code !== 'too_many_requests' && code !== 'busy') file.current = null
      setStep({ kind: 'error', message: api?.network ? networkErrorMessage : boletoErrorMessage(api?.problem) })
    }
  }

  function choose(chosen: File) {
    onDiscard()
    if (chosen.size > MAX_BOLETO_BYTES) {
      file.current = null
      setStep({ kind: 'error', message: boletoErrorMessage({ title: 'file_too_large', status: 413, code: 'file_too_large' }) })
      return
    }
    file.current = chosen
    void read()
  }

  function sendPassword() {
    const input = passwordInput.current
    const password = input?.value ?? ''
    if (input) input.value = ''
    if (password) void read(password)
  }

  function manual() {
    file.current = null
    onDiscard()
    setStep({ kind: 'idle' })
    onManual()
  }

  const first = step.kind === 'done' ? step.extraction.items[0] : undefined
  const duplicateId = first?.duplicateOfInvoiceId ?? undefined

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInput}
        type="file"
        // Sem `capture`: no celular o sistema oferece câmera, galeria e arquivos.
        accept="application/pdf,image/png,image/jpeg"
        aria-label="Arquivo do boleto"
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0]
          e.target.value = '' // deixa escolher o mesmo arquivo de novo
          if (chosen) choose(chosen)
        }}
      />

      {step.kind === 'idle' && (
        <>
          <Button type="button" variant="secondary" onClick={pick}>
            Importar boleto
          </Button>
          <p className="text-meta text-muted">
            PDF, foto ou print do boleto ou da conta (até 5 MB). Você confere tudo antes de salvar. Várias contas ou arquivos?{' '}
            <Link to="/importar" className="font-semibold text-accent underline underline-offset-2">
              Importar várias
            </Link>
          </p>
        </>
      )}

      {step.kind === 'reading' && (
        <p role="status" className="flex min-h-11 items-center justify-center rounded-md border border-line-strong text-sm">
          lendo o boleto…
        </p>
      )}

      {step.kind === 'password' && (
        <div className="flex flex-col gap-2 rounded-md bg-sunken p-3">
          <Field
            ref={passwordInput}
            label="Senha do PDF"
            type="password"
            autoComplete="off"
            autoFocus
            hint="Usada só para abrir este arquivo; não fica guardada."
            error={step.wrong ? 'Senha incorreta. Confira e tente de novo.' : undefined}
            onKeyDown={(e) => {
              // Enter aqui abre o PDF, não salva a conta (o campo está dentro do formulário da conta).
              if (e.key === 'Enter') {
                e.preventDefault()
                sendPassword()
              }
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={sendPassword}>
              Abrir PDF
            </Button>
            <Button type="button" variant="secondary" onClick={manual}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'error' && (
        <div className="flex flex-col gap-2">
          <FormError message={step.message} />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" onClick={() => void read()}>
              Tentar de novo
            </Button>
            <Button type="button" variant="secondary" onClick={manual}>
              Preencher manualmente
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'done' && step.extraction.kind === 'list' && (
        <section aria-label="Várias contas no arquivo" className="flex flex-col gap-3 rounded-md border-2 border-accent p-3">
          <div>
            <h3 className="text-sm font-semibold">Encontrei {step.extraction.items.length} contas neste arquivo</h3>
            <p className="text-meta text-muted">Para criar todas de uma vez, abra em Importar e confira cada uma.</p>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {step.extraction.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{it.description ?? 'sem descrição'}</span>
                <span className="font-mono tabular-nums">{formatCents(it.amountCents ?? 0)}</span>
              </li>
            ))}
          </ul>
          <Button type="button" onClick={() => navigate('/importar', { state: { extraction: step.extraction, fileName: step.fileName } })}>
            Abrir em Importar
          </Button>
          <button type="button" className={link} onClick={pick}>
            Importar outro arquivo
          </button>
        </section>
      )}

      {step.kind === 'done' && step.extraction.kind !== 'list' && first && (
        <section aria-label="Conferir antes de salvar" className="flex flex-col gap-3 rounded-md border-2 border-accent p-3">
          <div>
            <h3 className="text-sm font-semibold">Conferir antes de salvar</h3>
            <p className="text-meta text-muted">
              {first.boleto
                ? 'Valor, vencimento e descrição vieram do boleto. Confira e corrija se precisar.'
                : 'Conta sem código de barras: valor e vencimento vieram do documento. Confira e corrija se precisar.'}
            </p>
          </div>
          {duplicateId && showDuplicate && (
            <div role="alert" className="flex flex-col gap-1 rounded-md border-l-2 border-alert bg-sunken px-3 py-2 text-sm text-ink">
              <p>
                <span aria-hidden="true" className="font-mono text-alert">[ ✖ ]</span> Já existe uma conta com este boleto.
              </p>
              <div className="flex flex-wrap gap-x-4">
                {onOpenInvoice && (
                  <button type="button" className={link} onClick={() => onOpenInvoice(duplicateId)}>
                    Abrir a conta
                  </button>
                )}
                <button type="button" className={link} onClick={() => setShowDuplicate(false)}>
                  Fechar aviso
                </button>
              </div>
            </div>
          )}
          {first.boleto ? (
            <BoletoBox
              boleto={{ ...first.boleto, beneficiaryName: first.beneficiaryName, beneficiaryVerified: first.beneficiaryVerified }}
              method={step.extraction.method === 'text' ? undefined : step.extraction.method}
            />
          ) : (
            <p className="text-meta">
              <span aria-hidden="true" className={`font-mono ${step.extraction.method === 'ocr' ? 'text-alert' : 'text-accent'}`}>
                {step.extraction.method === 'ocr' ? '[ ✖ ]' : '[ ▪ ]'}
              </span>{' '}
              {step.extraction.method === 'ocr' ? 'conta lida por OCR: confira os números' : (step.extraction.method === 'text' ? 'conta lida do texto colado' : 'conta lida do texto do PDF')}
              {first.beneficiaryName && <> · {first.beneficiaryName}</>}
            </p>
          )}
          <button type="button" className={link} onClick={pick}>
            Importar outro arquivo
          </button>
        </section>
      )}
    </div>
  )
}
