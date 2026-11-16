import { describe, expect, it } from 'vitest'
import {
  automationAudienceLabel,
  automationDefault,
  automationJobStatusLabel,
  automationSampleReason,
  automationTextTokens,
  validFixedSchedule,
} from './domain'

describe('automation admin domain', () => {
  it('builds defaults accepted by each automation type', () => {
    expect(automationDefault('initial')).toMatchObject({
      audience: 'pending',
      anchor: 'activation',
      enabled: false,
      maxExecutions: 1,
    })
    expect(automationDefault('admin_summary')).toMatchObject({
      audience: 'admin',
      anchor: 'event_start',
    })
  })

  it('exposes summary tokens only for the administrator summary', () => {
    expect(automationTextTokens('pending_reminder')).not.toContain('{{resumo.pendentes}}')
    expect(automationTextTokens('admin_summary')).toContain('{{resumo.pendentes}}')
  })

  it('accepts fixed schedules only with an explicit ISO offset', () => {
    expect(validFixedSchedule('2026-11-12T18:30:00-04:00')).toBe(true)
    expect(validFixedSchedule('2026-11-12T22:30:00Z')).toBe(true)
    expect(validFixedSchedule('2026-11-12T18:30')).toBe(false)
    expect(validFixedSchedule('2026-99-31T18:30:00-04:00')).toBe(false)
  })

  it('keeps provider states and suppression reasons readable', () => {
    expect(automationAudienceLabel('accepted')).toBe('Confirmados')
    expect(automationJobStatusLabel('retry_wait')).toBe('Aguardando nova tentativa')
    expect(automationSampleReason('no_consent')).toBe('O contato não autorizou WhatsApp')
    expect(automationSampleReason('future_reason')).toBe('future_reason')
  })
})
