import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAssistantNavigation, useAssistant } from './useAssistant'

function ref<T>(value: T) { return { value } }

function setup() {
  const request = vi.fn()
  const organizationId = ref('organization/id')
  const csrfToken = ref('csrf-token')
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  return { request, organizationId, ...useAssistant({ organizationId, csrfToken }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('assistente administrativo', () => {
  it('aceita somente destinos permitidos e eventos conhecidos', () => {
    expect(resolveAssistantNavigation({ type: 'area', area: 'connection' }, [])).toEqual({ type: 'area', area: 'connection' })
    expect(resolveAssistantNavigation({ type: 'area', area: 'billing' }, [])).toBeNull()
    expect(resolveAssistantNavigation({ type: 'event', area: 'template', eventId: 'event-1' }, ['event-1']))
      .toEqual({ type: 'event', area: 'template', eventId: 'event-1' })
    expect(resolveAssistantNavigation({ type: 'event', area: 'template', eventId: 'other-event' }, ['event-1'])).toBeNull()
    expect(resolveAssistantNavigation({ type: 'event', area: 'connection', eventId: 'event-1' }, ['event-1'])).toBeNull()
    expect(resolveAssistantNavigation('https://example.test', ['event-1'])).toBeNull()
  })

  it('abre somente etapas conhecidas da campanha do evento atual, sem ações de envio', () => {
    expect(resolveAssistantNavigation({ type: 'event', area: 'campaigns', eventId: 'event-1', step: 'verify' }, ['event-1']))
      .toEqual({ type: 'event', area: 'campaigns', eventId: 'event-1', step: 'verify' })
    expect(resolveAssistantNavigation({ type: 'event', area: 'campaigns', eventId: 'event-1', step: 'approve' }, ['event-1'])).toBeNull()
    expect(resolveAssistantNavigation({ type: 'event', area: 'campaigns', eventId: 'other-event', step: 'review' }, ['event-1'])).toBeNull()
    expect(resolveAssistantNavigation({ type: 'event', area: 'campaigns', eventId: 'event-1', action: 'approve_campaign' }, ['event-1'])).toBeNull()
    expect(resolveAssistantNavigation({ type: 'event', area: 'template', eventId: 'event-1', step: 'verify' }, ['event-1'])).toBeNull()
  })

  it('carrega o histórico e envia mensagem com CSRF no escopo da organização', async () => {
    const state = setup()
    const history = [{ role: 'assistant' as const, content: 'Como posso ajudar?', createdAt: '2026-10-10T12:00:00.000Z' }]
    const messages = [...history, { role: 'user' as const, content: 'Abra o WhatsApp', createdAt: '2026-10-10T12:01:00.000Z' }]
    state.request.mockResolvedValueOnce({ messages: history, pending: null })
      .mockResolvedValueOnce({ messages, reply: 'Abrindo.', navigation: { type: 'area', area: 'connection' } })

    await state.loadAssistant()
    const navigation = await state.sendMessage('  Abra o WhatsApp  ')

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/assistant')
    expect(state.request).toHaveBeenNthCalledWith(2, '/api/admin/organizations/organization%2Fid/assistant', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf-token' }, body: { message: 'Abra o WhatsApp' },
    })
    expect(state.messages.value).toEqual(messages)
    expect(navigation).toEqual({ type: 'area', area: 'connection' })
  })

  it('limpa o histórico e ignora resposta recebida após trocar de organização', async () => {
    const state = setup()
    state.messages.value = [{ role: 'assistant', content: 'Histórico atual', createdAt: '2026-10-10T12:00:00.000Z' }]
    let release!: (value: unknown) => void
    state.request.mockReturnValue(new Promise(resolve => { release = resolve }))

    const sending = state.sendMessage('Criar convite')
    state.organizationId.value = 'other-organization'
    state.resetAssistant()
    release({ messages: [{ role: 'assistant', content: 'Resposta antiga', createdAt: '2026-10-10T12:01:00.000Z' }], reply: 'Resposta antiga' })

    await expect(sending).resolves.toBeNull()
    expect(state.messages.value).toEqual([])
    expect(state.sending.value).toBe(false)
  })

  it('mantém o histórico quando o provedor falha e permite tentar de novo', async () => {
    const state = setup()
    state.messages.value = [{ role: 'assistant', content: 'Histórico atual', createdAt: '2026-10-10T12:00:00.000Z' }]
    state.request.mockRejectedValue(new Error('provider down'))

    await expect(state.sendMessage('Continue')).resolves.toBeNull()

    expect(state.messages.value).toHaveLength(1)
    expect(state.error.value).toBe('Não foi possível falar com o assistente. Tente novamente.')
    expect(state.sending.value).toBe(false)
  })
})
