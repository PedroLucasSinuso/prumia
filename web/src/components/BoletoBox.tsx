import type { Boleto, BoletoExtraction } from '../api/types'
import { formatDigitableLine, onlyDigits } from '../lib/boleto'
import { copyText } from '../lib/links'
import { Button } from './ui/Button'
import { useToast } from './toastContext'

type Method = BoletoExtraction['method']

// Como o servidor leu o boleto. OCR erra mais: pede conferência dos números.
const methodText: Record<Method, string> = {
  pdf_text: 'lido do texto do PDF',
  barcode_image: 'lido do código de barras',
  ocr: 'lido por OCR: confira os números',
}

/**
 * Linha digitável de um boleto, agrupada para leitura, com "Copiar linha digitável" (copia só os dígitos).
 * Serve na revisão da importação (com o método de leitura) e no detalhe de uma conta que já tem boleto.
 */
export function BoletoBox({ boleto, method }: { boleto: Boleto; method?: Method }) {
  const toast = useToast()
  const digits = onlyDigits(boleto.digitableLine)

  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Linha digitável</p>
        <p className="mt-1 select-all break-words font-mono text-sm leading-relaxed tabular-nums">
          {formatDigitableLine(boleto.digitableLine)}
        </p>
      </div>
      {boleto.beneficiaryName && (
        <p className="text-sm">
          <span className="text-muted">Beneficiário:</span> {boleto.beneficiaryName}
          {boleto.beneficiaryVerified && (
            <span className="ml-1 text-xs text-muted">
              <span aria-hidden="true" className="font-mono text-accent">[ ▪ ]</span> conferido pelo CNPJ
            </span>
          )}
        </p>
      )}
      {method && (
        <p className={`text-xs ${method === 'ocr' ? 'font-semibold text-ink' : 'text-muted'}`}>
          <span aria-hidden="true" className={`font-mono ${method === 'ocr' ? 'text-alert' : 'text-accent'}`}>
            {method === 'ocr' ? '[ ✖ ]' : '[ ▪ ]'}
          </span>{' '}
          {methodText[method]}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={async () =>
          toast({ message: (await copyText(digits)) ? 'Linha digitável copiada.' : 'Não deu para copiar. Selecione a linha e copie.' })
        }
      >
        Copiar linha digitável
      </Button>
    </div>
  )
}
