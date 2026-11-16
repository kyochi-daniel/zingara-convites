import { describe, expect, test } from 'vitest'
import {
  assistantDecision,
  assistantMessageInput,
  assistantModelDecision,
  assistantNavigation,
  sanitizeAssistantPending,
  sanitizeAssistantText,
} from '../packages/contracts/src/index'

describe('contrato do assistente', () => {
  test('limita mensagem e rejeita ação desconhecida', () => {
    expect(assistantMessageInput.safeParse({ message: 'Crie um convite' }).success).toBe(true)
    expect(assistantMessageInput.safeParse({ message: '' }).success).toBe(false)
    expect(assistantMessageInput.safeParse({ message: 'x'.repeat(2_001) }).success).toBe(false)
    expect(assistantDecision.safeParse({ action: 'shell', command: 'rm -rf /' }).success).toBe(false)
  })

  test('aceita somente navegação tipada sem URL livre', () => {
    expect(assistantNavigation.safeParse({ type: 'area', area: 'connection' }).success).toBe(true)
    expect(assistantNavigation.safeParse({ type: 'event', area: 'invitations', eventId: 'a'.repeat(24) }).success).toBe(true)
    expect(assistantNavigation.safeParse({ type: 'event', area: 'campaigns', eventId: 'a'.repeat(24) }).success).toBe(true)
    expect(assistantNavigation.safeParse({ type: 'area', area: 'campaigns' }).success).toBe(false)
    expect(assistantNavigation.safeParse({ type: 'area', area: 'settings', url: 'https://evil.test' }).success).toBe(false)
    expect(assistantNavigation.safeParse({ type: 'event', area: 'home', eventId: 'a'.repeat(24) }).success).toBe(false)
  })

  test('modelo só pode abrir campanhas de um evento identificado', () => {
    const envelope = { action: 'navigate', organizationId: 'a'.repeat(24), reply: 'Abri campanhas',
      navigation: { type: 'event', area: 'campaigns', eventId: 'b'.repeat(24) },
      event: null, guest: null, eventId: null, guestId: null, expiresAt: null, pending: null }
    expect(assistantModelDecision.safeParse(envelope).success).toBe(true)
    expect(assistantDecision.safeParse({ action: 'navigate', organizationId: envelope.organizationId,
      reply: envelope.reply, navigation: { type: 'event', area: 'campaigns', eventId: null } }).success).toBe(false)
  })

  test('exige organização atual nas ações mutáveis', () => {
    const event = {
      name: 'Festa', location: 'Salão', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
      endsAt: '2027-01-02T23:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
      timeZone: 'America/Campo_Grande', companionLimit: 0, companionNamesRequired: false,
    }
    expect(assistantDecision.safeParse({ action: 'create_event', organizationId: 'a'.repeat(24), event }).success).toBe(true)
    expect(assistantDecision.safeParse({ action: 'create_event', event }).success).toBe(false)
  })

  test('remove credenciais, QR e link secreto da conversa', () => {
    const text = 'token: segredo-total Bearer abcdefghijklmnop /i/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ data:image/png;base64,AAAA'
    const safe = sanitizeAssistantText(text)
    expect(safe).not.toContain('segredo-total')
    expect(safe).not.toContain('abcdefghijklmnop')
    expect(safe).not.toContain('/i/')
    expect(safe).not.toContain('base64,AAAA')
    const opaqueToken = 'A'.repeat(43)
    expect(sanitizeAssistantText(`referência ${opaqueToken}`)).not.toContain(opaqueToken)
    const edgeToken = `--${'A'.repeat(39)}--`
    expect(sanitizeAssistantText(`referência ${edgeToken}`)).not.toContain(edgeToken)
    expect(sanitizeAssistantText('token: parte1 parte2')).not.toContain('parte2')
    expect(sanitizeAssistantPending({ intent: 'convidar', fields: {
      nome: 'Ana', apiToken: 'segredo', link: 'https://convite.test/i/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    } })).toEqual({ intent: 'convidar', fields: { nome: 'Ana' } })
    const proposal = sanitizeAssistantPending({ intent: 'assistant_proposal', proposal: {
      action: 'create_guest', organizationId: 'a'.repeat(24),
      guest: { name: 'Ana', phone: '+5567999999999', tags: [], notes: opaqueToken, whatsappConsent: true,
        authorizationSource: 'Formulário presencial assinado' },
    } })
    expect(proposal).toMatchObject({ intent: 'assistant_proposal', proposal: { action: 'create_guest',
      guest: { name: 'Ana', phone: '+5567999999999', notes: '[dado longo removido]' } } })
    expect(JSON.stringify(proposal)).not.toContain(opaqueToken)
  })
})
