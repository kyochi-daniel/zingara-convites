import { describe, expect, it } from 'vitest'
import { deliveryCampaignApprovalInput, deliveryCampaignPlanInput } from '../packages/contracts/src/index'

describe('contratos de campanha agendada', () => {
  it('aceita instante ISO com offset e modo imediato explícito por null', () => {
    const invitationId = 'a'.repeat(24)
    expect(deliveryCampaignPlanInput.parse({ invitationIds: [invitationId], intervalMs: 5000,
      scheduledAt: '2026-10-19T09:00:00-04:00' })).toMatchObject({ scheduledAt: '2026-10-19T09:00:00-04:00' })
    expect(deliveryCampaignPlanInput.parse({ invitationIds: [invitationId], scheduledAt: null }))
      .toMatchObject({ scheduledAt: null })
  })

  it('rejeita campos extras, data sem fuso, duplicatas e intervalo fora do limite', () => {
    const invitationId = 'b'.repeat(24)
    for (const input of [
      { invitationIds: [invitationId], scheduledAt: '2026-10-19T09:00:00' },
      { invitationIds: [invitationId, invitationId] },
      { invitationIds: [invitationId], intervalMs: 1999 },
      { invitationIds: [invitationId], extra: true },
    ]) expect(deliveryCampaignPlanInput.safeParse(input).success).toBe(false)
    expect(deliveryCampaignApprovalInput.safeParse({ approve: true, previewHash: 'a'.repeat(64), scheduledAt: null }).success)
      .toBe(false)
  })
})
