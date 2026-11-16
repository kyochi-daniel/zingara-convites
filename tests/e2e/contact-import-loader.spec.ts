import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { parseContactFile } from '../../packages/core/src/contact-import'

test('o loader CJS do Playwright carrega e executa os parsers DOC e DOCX', async () => {
  for (const extension of ['doc', 'docx']) {
    const contentBase64 = (await readFile(`tests/fixtures/contacts/contacts.${extension}`)).toString('base64')
    const rows = await parseContactFile({ name: `contacts.${extension}`, contentBase64 })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.guest?.phone).toBe('+5567999991111')
  }
})
