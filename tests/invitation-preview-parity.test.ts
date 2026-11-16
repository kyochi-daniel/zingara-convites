import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8')
const shared = source('packages/invitation-ui/InvitationArtwork.vue')
const publicArtwork = source('apps/invite/app/components/InvitationArtwork.vue')
const adminPreview = source('apps/admin/app/components/templates/EditorialTemplate.vue')

describe('prévia do convite', () => {
  it('mantém o renderizador público e sua apresentação iguais aos da prévia', () => {
    expect(adminPreview).toContain('packages/invitation-ui/InvitationArtwork.vue')
    if (publicArtwork.includes('packages/invitation-ui/InvitationArtwork.vue')) return
    expect(shared.replace("'../contracts/src/index'", "'@zingara/contracts'")).toBe(publicArtwork)
  })
})
