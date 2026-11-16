import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseContactFile, parseContactText } from '../packages/core/src/contact-import'

describe('contact document ingestion', () => {
  it('normalizes Portuguese CSV, preserves accents and reports every invalid row', () => {
    const rows = parseContactText('\uFEFFNome;Telefone\r\n  Ana   Silva ;(67) 99999-1111\r\nSem telefone;abc\r\nBeto;005567999992222', 'csv')
    expect(rows.map(row => row.line)).toEqual([2, 3, 4])
    expect(rows[0].guest).toMatchObject({ name: 'Ana Silva', phone: '+5567999991111', whatsappConsent: false })
    expect(rows[1].errors).toContain('Telefone inválido. Use DDD e número ou formato internacional.')
    expect(rows[2].guest?.phone).toBe('+5567999992222')
  })

  it('supports plain lines and never infers consent from their contents', () => {
    const rows = parseContactText('Ana Silva - (67) 99999-1111\nNome sem número\nBeto\t+1 (212) 555-0123', 'txt')
    expect(rows[0].line).toBe(1)
    expect(rows[0].guest?.whatsappConsent).toBe(false)
    expect(rows[1].errors.length).toBeGreaterThan(0)
    expect(rows[2].guest?.phone).toBe('+12125550123')
    expect(() => parseContactText('name,phone,whatsappConsent\nAna,+5567999991111,true', 'csv')).toThrow('Cabeçalho inválido')
  })

  it('rejects ambiguous CSV and excessive contact counts', () => {
    expect(() => parseContactText('name,phone\n"Ana,+5567999991111', 'csv')).toThrow('aspas')
    expect(() => parseContactText('name,phone\n"Ana"extra,+5567999991111', 'csv')).toThrow('aspas')
    expect(() => parseContactText('name,phone\n' + 'Ana,+5567999991111\n'.repeat(201), 'csv')).toThrow('200')
  })

  for (const extension of ['txt', 'docx', 'doc']) {
    it(`extracts ${extension} without persisting files or changing consent`, async () => {
      const content = await readFile(`tests/fixtures/contacts/contacts.${extension}`)
      const rows = await parseContactFile({ name: `contacts.${extension}`, contentBase64: content.toString('base64') })
      expect(rows).toHaveLength(2)
      expect(rows[0].guest).toMatchObject({ name: 'Ana Silva', phone: '+5567999991111', whatsappConsent: false })
    }, 15000)
  }

  it('rejects spoofed, corrupt, unsupported, non-UTF8 and oversized files safely', async () => {
    for (const file of [
      { name: 'contacts.exe', contentBase64: Buffer.from('text').toString('base64') },
      { name: 'contacts.doc', contentBase64: Buffer.from('text').toString('base64') },
      { name: 'contacts.docx', contentBase64: Buffer.from('PK\x03\x04broken').toString('base64') },
      { name: 'contacts.txt', contentBase64: '/w==' },
      { name: 'contacts.txt', contentBase64: Buffer.alloc(262145).toString('base64') },
      { name: 'contacts.txt', contentBase64: 'not base64' },
    ]) await expect(parseContactFile(file)).rejects.toThrow(SyntaxError)
  }, 25000)

  it('rejects ZIP expansion beyond 1 MiB and limits concurrent document parsers', async () => {
    const bomb = await readFile('tests/fixtures/contacts/oversized.docx')
    await expect(parseContactFile({ name: 'bomb.docx', contentBase64: bomb.toString('base64') })).rejects.toThrow('limites')
    const contentBase64 = (await readFile('tests/fixtures/contacts/contacts.doc')).toString('base64')
    const results = await Promise.allSettled([1, 2, 3].map(() => parseContactFile({ name: 'contacts.doc', contentBase64 })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  }, 30000)

  it('reads contacts arranged in a Word table', async () => {
    const contentBase64 = (await readFile('tests/fixtures/contacts/table.docx')).toString('base64')
    const rows = await parseContactFile({ name: 'table.docx', contentBase64 })
    expect(rows).toHaveLength(2)
    expect(rows.every(row => !row.errors.length)).toBe(true)
  }, 15000)

  it('rejects legacy DOC allocation cycles and forged sector counts', async () => {
    const original = await readFile('tests/fixtures/contacts/contacts.doc')
    const count = Buffer.from(original)
    count.writeUInt32LE(0x7fffffff, 44)
    await expect(parseContactFile({ name: 'count.doc', contentBase64: count.toString('base64') })).rejects.toThrow('limites')
    const cycle = Buffer.from(original)
    const sectorBytes = 1 << cycle.readUInt16LE(30)
    const fat = (cycle.readUInt32LE(76) + 1) * sectorBytes
    const directory = cycle.readUInt32LE(48)
    cycle.writeInt32LE(directory, fat + directory * 4)
    await expect(parseContactFile({ name: 'cycle.doc', contentBase64: cycle.toString('base64') })).rejects.toThrow('limites')
  }, 25000)
})
