import { useRef, useState } from 'react'

import { ApiError } from '../api/errors'
import type { BoletoExtraction } from '../api/types'
import { boletoErrorMessage, networkErrorMessage } from '../auth/errors'
import { MAX_BOLETO_BYTES } from '../lib/boleto'
import { BoletoBox } from './BoletoBox'
import { Button } from './Button'
import { Field } from './Field'
import { FormError } from './FormError'

type Step =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'done'; extraction: BoletoExtraction }

type Props = {
  /** Envia o arquivo (e a senha, se houver) para o servidor ler. Rejeita com ApiError. */
  onExtract: (file: File, password?: string) => Promise<BoletoExtraction>
  /** Leitura deu certo: o formulário se pré-preenche com o que veio. */
  onExtracted: (extraction: BoletoExtraction) => void
  /** Começou outra leitura ou desistiu: o boleto anterior não vale mais (os campos já preenchidos ficam). */
  onDiscard: () => void
  /** A pessoa desistiu da leitura e vai digitar. */
  onManual: () => void
  /** Abre a conta que já tem este boleto (aviso de duplicidade). */
  onOpenInvoice?: (id: string) => void
}

const link = 'flex min-h-11 items-center text-sm font-semibold text-cobalt underline underline-offset-4'

/**
 * "Importar boleto": escolher arquivo -> lendo… -> (senha do PDF, se pedir) -> conferir antes de salvar.
 * Nada é salvo aqui: só pré-preenche o formulário. O arquivo fica num ref (memória do navegador) só enquanto pode ser
 * reenviado (senha, falha de rede); a senha nunca vai para o estado do React: é lida do campo no envio e o campo é limpo.
 */
export function BoletoImport({ onExtract, onExtracted, onDiscard, onManual, onOpenInvoice }: Props) {
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
      setStep({ kind: 'done', extraction })
      onExtracted(extraction)
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

  const duplicateId = step.kind === 'done' ? step.extraction.duplicateOfInvoiceId : undefined

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
          <Button type="button" variant="ghost" onClick={pick}>
            Importar boleto
          </Button>
          <p className="text-xs text-graphite/70">PDF, foto ou print do boleto (até 5 MB). Você confere tudo antes de salvar.</p>
        </>
      )}

      {step.kind === 'reading' && (
        <p role="status" className="flex min-h-11 items-center justify-center rounded-md border border-graphite/25 text-sm">
          lendo o boleto…
        </p>
      )}

      {step.kind === 'password' && (
        <div className="flex flex-col gap-2 rounded-md border border-graphite/25 p-3">
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
            <Button type="button" variant="ghost" onClick={manual}>
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
            <Button type="button" variant="ghost" onClick={manual}>
              Preencher manualmente
            </Button>
          </div>
        </div>
      )}

      {step.kind === 'done' && (
        <section aria-label="Conferir antes de salvar" className="flex flex-col gap-3 rounded-md border-2 border-cobalt p-3">
          <div>
            <h3 className="text-sm font-semibold">Conferir antes de salvar</h3>
            <p className="text-xs text-graphite/75">Valor, vencimento e descrição vieram do boleto. Confira e corrija se precisar.</p>
          </div>
          {duplicateId && showDuplicate && (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-signal/60 bg-signal/10 px-3 py-2 text-sm">
              <p>
                <span aria-hidden="true" className="font-mono text-signal">[ ✖ ]</span> Já existe uma conta com este boleto.
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
          <BoletoBox boleto={step.extraction.boleto} method={step.extraction.method} />
          <button type="button" className={link} onClick={pick}>
            Importar outro boleto
          </button>
        </section>
      )}
    </div>
  )
}
