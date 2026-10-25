import { describe, expect, it } from 'vitest'

import type { Category, DocumentExtraction, Payee } from '../api/types'
import { markRepeated, monthsText, normalize, progressMarks, rowErrors, rowsFrom, suggestCategory, toInput } from './importing'

const cats: Category[] = [
  { id: 'mor', name: 'Moradia', isEssential: true, sortOrder: 0, archived: false },
  { id: 'gas', name: 'Gás', parentId: 'mor', isEssential: true, sortOrder: 0, archived: false },
  { id: 'mer', name: 'Mercado', isEssential: true, sortOrder: 1, archived: false },
  { id: 'pet', name: 'Pets', isEssential: false, sortOrder: 2, archived: true },
]
const payees: Payee[] = [{ id: 'p1', name: 'Petshop da Rua', defaultCategoryId: 'mer', archived: false }]

describe('suggestCategory', () => {
  it('segue a ordem favorecido reconhecido > nome do favorecido > nome da categoria > primeira', () => {
    expect(suggestCategory({ description: 'Gás', payee: { id: 'x', name: 'X', defaultCategoryId: 'mer', archived: false } }, cats, payees)).toBe('mer')
    expect(suggestCategory({ description: 'Ração no Petshop da Rua' }, cats, payees)).toBe('mer')
    expect(suggestCategory({ description: 'GAS' }, cats, payees)).toBe('gas')
    expect(suggestCategory({ description: 'mercado do mês' }, cats, payees)).toBe('mer')
    expect(suggestCategory({ description: 'Moradia' }, cats, payees)).toBe('mor')
    // categoria arquivada não é sugerida; sem casamento, a primeira
    expect(suggestCategory({ description: 'Pets' }, cats, payees)).toBe('mor')
    expect(suggestCategory({ beneficiaryName: 'Gasco Distribuidora SA' }, cats, payees)).toBe('mor')
  })
  it('normaliza acento e caixa', () => {
    expect(normalize('Ração, GATOS!')).toBe('racao gatos')
  })
})

const list: DocumentExtraction = {
  kind: 'list', method: 'ocr',
  items: [{ description: 'Gás', amountCents: 15782 }, { description: 'Mercado', amountCents: 56899 }],
}

describe('rowsFrom e toInput', () => {
  it('preenche vencimento com hoje e competência com o mês do vencimento', () => {
    const rows = rowsFrom(list, 'f1', '2026-10-22', cats, payees)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ origin: 'list', ocr: true, description: 'Gás', amountCents: 15782, dueDate: '2026-10-22', competence: '2026-10', categoryId: 'gas', include: true })
    expect(toInput(rows[1])).toEqual({ categoryId: 'mer', description: 'Mercado', amountCents: 56899, dueDate: '2026-10-22', competenceMonth: '2026-10-01' })
  })
  it('boleto duplicado fica fora; favorecido novo de conta sem boleto leva o CNPJ', () => {
    const [dup] = rowsFrom({ kind: 'boleto', method: 'pdf_text', items: [{ amountCents: 100, boleto: { digitableLine: '1'.repeat(47) }, duplicateOfInvoiceId: 'i1' }] }, 'f', '2026-10-22', cats, [])
    expect(dup.include).toBe(false)
    const [bill] = rowsFrom({ kind: 'bill', method: 'pdf_text', items: [{ amountCents: 13043, dueDate: '2026-07-17', competenceMonth: '2026-06-01', beneficiaryName: 'Gasco Distribuidora SA', beneficiaryCnpj: '11222333000181' }] }, 'f', '2026-10-22', cats, [])
    expect(bill).toMatchObject({ description: 'Gasco Distribuidora SA', competence: '2026-06' })
    expect(toInput({ ...bill, newPayeeName: 'Gás' }).newPayee).toEqual({ name: 'Gás', cnpj: '11222333000181', legalName: 'Gasco Distribuidora SA' })
  })
  it('o mesmo boleto em dois arquivos: o segundo sai do lote', () => {
    const one = { kind: 'boleto', method: 'pdf_text', items: [{ amountCents: 100, boleto: { digitableLine: '2'.repeat(47) } }] } as DocumentExtraction
    const rows = markRepeated([...rowsFrom(one, 'a', '2026-10-22', cats, []), ...rowsFrom(one, 'b', '2026-10-22', cats, [])])
    expect(rows.map((r) => [r.include, r.duplicateOf])).toEqual([[true, undefined], [false, 'batch']])
  })
})

describe('rowErrors e progressMarks', () => {
  it('leva o erro de items.N para a linha incluída N', () => {
    const rows = rowsFrom(list, 'f1', '2026-10-22', cats, payees)
    expect(rowErrors({ 'items.1.amountCents': 'valor', other: 'x' }, rows)).toEqual({ [rows[1].key]: { amountCents: 'valor' } })
  })
  it('desenha um marcador por arquivo', () => {
    expect(progressMarks(2, 5)).toBe('[ ▪ ▪ ▫ ▫ ▫ ]')
    expect(progressMarks(0, 0)).toBe('[  ]')
  })
})

describe('monthsText (aviso depois de importar)', () => {
  it('lista os meses em português, com o ano só quando ele é outro', () => {
    expect(monthsText(['2026-10-01'], '2026-10-01')).toBe('outubro')
    expect(monthsText(['2026-10-01', '2026-11-01'], '2026-10-01')).toBe('outubro e novembro')
    expect(monthsText(['2026-06-01', '2026-07-01', '2026-10-01'], '2026-10-01')).toBe('junho, julho e outubro')
    expect(monthsText(['2026-12-01', '2027-01-01'], '2026-12-01')).toBe('dezembro e janeiro de 2027')
  })
})
