import type { Boleto, Category, DocumentExtraction, DocumentItem, InvoiceInput, Payee } from '../api/types'
import { buildTree } from './categories'
import { monthOf } from './dates'

/**
 * Regras puras da tela "Importar" (sem rede nem React): transformar o que o servidor leu em linhas editáveis,
 * sugerir a categoria e montar o lote. Ficam aqui para serem testadas sozinhas (lib/importing.test.ts).
 */

export type Origin = DocumentExtraction['kind']

/** Uma conta a revisar. Tudo é editável; `include` = vai no lote. */
export type ImportRow = {
  key: string
  /** Arquivo de onde veio (pré-visualização). */
  fileId: string
  origin: Origin
  ocr: boolean
  description: string
  amountCents: number
  dueDate: string
  /** AAAA-MM */
  competence: string
  categoryId: string
  include: boolean
  boleto?: Boleto
  beneficiaryName?: string
  beneficiaryCnpj?: string
  /** Favorecido da casa reconhecido pelo CNPJ. */
  payee?: Payee
  /** Apelido de um favorecido NOVO (só para quem tem CNPJ e ainda não é favorecido). */
  newPayeeName: string
  /** Já existe conta com este boleto (id) ou o mesmo boleto apareceu antes nesta importação ('batch'). */
  duplicateOf?: string
}

/** Sem acento, sem caixa, só letras/números separados por espaço: "Ração, Gatos!" -> "racao gatos". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const hasWord = (text: string, word: string) => word !== '' && ` ${text} `.includes(` ${word} `)

/**
 * Categoria sugerida, nesta ordem: (1) a do favorecido reconhecido pelo CNPJ; (2) a de um favorecido da casa cujo
 * nome aparece no texto; (3) a categoria (ou subcategoria) cujo nome aparece no texto, preferindo a mais específica
 * ("Gás" casa com Moradia › Gás antes de Moradia); (4) a primeira categoria. Só categorias ativas.
 */
export function suggestCategory(item: Pick<DocumentItem, 'description' | 'beneficiaryName' | 'payee'>, categories: Category[], payees: Payee[]): string {
  const active = categories.filter((c) => !c.archived)
  const ids = new Set(active.map((c) => c.id))
  const valid = (id?: string | null) => (id && ids.has(id) ? id : undefined)

  const fromPayee = valid(item.payee?.defaultCategoryId)
  if (fromPayee) return fromPayee

  const text = normalize([item.description, item.beneficiaryName].filter(Boolean).join(' '))
  if (text) {
    const named = payees
      .filter((p) => !p.archived && valid(p.defaultCategoryId) && hasWord(text, normalize(p.name)))
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (named?.defaultCategoryId) return named.defaultCategoryId

    // Subcategorias primeiro (mais específicas); dentro do mesmo nível, o nome mais longo.
    const match = active
      .filter((c) => hasWord(text, normalize(c.name)))
      .sort((a, b) => Number(Boolean(b.parentId)) - Number(Boolean(a.parentId)) || b.name.length - a.name.length)[0]
    if (match) return match.id
  }
  return buildTree(active)[0]?.category.id ?? ''
}

let seq = 0

/** Linhas a revisar a partir de uma leitura. Vencimento ausente = hoje; competência ausente = mês do vencimento. */
export function rowsFrom(ext: DocumentExtraction, fileId: string, today: string, categories: Category[], payees: Payee[]): ImportRow[] {
  return ext.items.map((it) => {
    const due = it.dueDate ?? today
    const description = (it.payee?.name ?? it.description ?? it.beneficiaryName ?? '').slice(0, 120)
    seq += 1
    return {
      key: `${fileId}-${seq}`,
      fileId,
      origin: ext.kind,
      ocr: ext.method === 'ocr',
      description,
      amountCents: it.amountCents ?? 0,
      dueDate: due,
      competence: (it.competenceMonth ?? monthOf(due)).slice(0, 7),
      categoryId: suggestCategory(it, categories, payees),
      // Boleto já lançado: fica de fora até a pessoa pedir para incluir.
      include: !it.duplicateOfInvoiceId,
      boleto: it.boleto ? { digitableLine: it.boleto.digitableLine, beneficiaryName: it.beneficiaryName, beneficiaryCnpj: it.beneficiaryCnpj } : undefined,
      beneficiaryName: it.beneficiaryName,
      beneficiaryCnpj: it.beneficiaryCnpj,
      payee: it.payee ?? undefined,
      newPayeeName: '',
      duplicateOf: it.duplicateOfInvoiceId ?? undefined,
    }
  })
}

/** Marca como repetida (e tira do lote) a linha cujo boleto já apareceu em outra linha desta importação. */
export function markRepeated(rows: ImportRow[]): ImportRow[] {
  const seen = new Set<string>()
  return rows.map((r) => {
    const line = r.boleto?.digitableLine
    if (!line) return r
    if (seen.has(line)) return r.duplicateOf ? r : { ...r, duplicateOf: 'batch', include: false }
    seen.add(line)
    return r
  })
}

/** Corpo do lote para as linhas incluídas, na ordem. */
export function toInput(r: ImportRow): InvoiceInput {
  const nick = r.newPayeeName.trim()
  return {
    categoryId: r.categoryId,
    description: r.description.trim(),
    amountCents: r.amountCents,
    dueDate: r.dueDate,
    competenceMonth: `${r.competence}-01`,
    ...(r.boleto ? { boleto: r.boleto } : {}),
    ...(r.payee ? { payeeId: r.payee.id } : {}),
    ...(!r.payee && nick
      ? { newPayee: { name: nick, ...(!r.boleto && r.beneficiaryCnpj ? { cnpj: r.beneficiaryCnpj, ...(r.beneficiaryName ? { legalName: r.beneficiaryName } : {}) } : {}) } }
      : {}),
  }
}

/** Erros do lote ("items.3.amountCents") agrupados pela chave da linha (o índice é o das linhas incluídas). */
export function rowErrors(fields: Record<string, string>, included: ImportRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const [k, msg] of Object.entries(fields)) {
    const m = /^items\.(\d+)\.(.+)$/.exec(k)
    const row = m ? included[Number(m[1])] : undefined
    if (!m || !row) continue
    out[row.key] = { ...out[row.key], [m[2]]: msg }
  }
  return out
}

/** Espera antes de tentar de novo quando o servidor pede calma (429/503): 3, 6, 12, 20, 30 s. */
export const RETRY_DELAYS_MS = [3000, 6000, 12000, 20000, 30000]

/** "[ ▪ ▪ ▪ ▫ ▫ ]": um marcador por arquivo (cheio = já lido). Acima de 10 arquivos, escala para 10. */
export function progressMarks(done: number, total: number): string {
  const slots = Math.min(total, 10)
  const filled = total === 0 ? 0 : Math.round((done / total) * slots)
  return `[ ${Array.from({ length: slots }, (_, i) => (i < filled ? '▪' : '▫')).join(' ')} ]`
}
