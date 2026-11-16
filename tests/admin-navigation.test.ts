import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync('apps/admin/app/components/DesignShell.vue', 'utf8')
const icon = (name: string) => readFileSync(`apps/admin/public/design/${name}.svg`, 'utf8')
  .replace(/stroke="#[A-Fa-f0-9]+"/g, 'stroke="currentColor"')

describe('navegação administrativa', () => {
  it('mantém o mesmo símbolo de cada área nos dois estados', () => {
    for (const area of ['events', 'guests']) {
      expect(icon(`sidebar-${area}-active`)).toBe(icon(`sidebar-${area}`))
      expect(icon(`mobile-${area}-active`)).toBe(icon(`mobile-${area}`))
    }
  })

  it('oferece organização, configurações e saída no shell', () => {
    expect(shell).toContain('selectOrganization')
    expect(shell).toContain('selectedOrganizationId')
    expect(shell).not.toContain('design-brand')
    expect(shell.indexOf('design-organization-select')).toBeLessThan(shell.indexOf('design-nav-heading'))
    expect(shell).toContain('Configurações')
    expect(shell).toContain('WhatsApp')
    expect(shell).toContain("emit('logout')")
  })
})
