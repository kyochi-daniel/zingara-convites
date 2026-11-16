import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCampaigns, type Campaign, type CampaignPreview } from './useCampaigns'
import type { Guest } from '../guests/useGuests'
import type { Invitation } from '../invitations/useInvitations'

function ref<T>(value: T) { return { value } }
const guest: Guest = { id: 'guest-1', name: 'Contato de teste', phone: '+5567999990001', tags: [], notes: '', whatsappConsent: true }
const event = { id: 'event/id', name: 'Evento de teste', publishedTemplateVersion: 1, status: 'published',
  rsvpDeadline: '2099-01-01T16:00:00.000Z', timeZone: 'America/Campo_Grande' }
const invitation: Invitation = { id: 'invitation-1', guestId: guest.id, guestName: guest.name, responseStatus: 'pending', expiresAt: '2099-01-01', templateVersion: 1,
  companions: [], responseVersion: 0, createdAt: '2026-10-15T12:00:00Z' }
const campaign: Campaign = { id: 'campaign/id', eventId: event.id, status: 'draft', intervalMs: 5000, previewHash: 'hash', recipientCount: 1, approvedMode: 'fake' }
const preview: CampaignPreview = { previewHash: 'hash', intervalMs: 5000, items: [{
  invitationId: invitation.id, recipient: { name: guest.name, phone: guest.phone, whatsappConsent: true },
  text: 'Olá, contato de teste', link: 'https://invite.example.test/i/test', mode: 'fake', previewHash: 'individual',
}] }
function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', <T>(getter: () => T) => ({ get value() { return getter() } }))
  const organizationId = ref('organization/id')
  const state = useCampaigns({ organizationId, csrfToken: ref('csrf'), event: ref(event) })
  state.guests.value = [guest]
  state.invitations.value = [invitation]
  state.connection.value = { connectionId: 'connection-1', revision: 1, channel: 'baileys' }
  state.connectionState.value = 'connected'
  state.selectGuest(guest, true)
  return { request, organizationId, ...state }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('preparação e aprovação humana de campanha', () => {
  it('bloqueia prévia sem consentimento, convite ou conexão pronta', async () => {
    const state = setup()
    state.selectGuest(guest, false)
    state.selectGuest({ ...guest, whatsappConsent: false }, true)
    await state.createPreview()
    expect(state.request).not.toHaveBeenCalled()
    expect(state.blockers.value).toContain('Há contatos sem consentimento WhatsApp.')
    state.selectGuest(guest, false)
    state.selectGuest(guest, true)
    state.connectionState.value = 'connecting'
    await state.createPreview()
    expect(state.request).not.toHaveBeenCalled()
    expect(state.blockers.value).toContain('Conecte o WhatsApp da organização antes de preparar a campanha.')
  })

  it('cria rascunho sem aprovar e envia somente hash revisado após confirmação', async () => {
    const state = setup()
    state.request.mockResolvedValueOnce({ campaign, preview })
    await state.createPreview()
    expect(state.request).toHaveBeenCalledExactlyOnceWith('/api/admin/organizations/organization%2Fid/events/event%2Fid/campaigns', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: { invitationIds: ['invitation-1'], intervalMs: 5000 },
    })
    await state.approveCampaign()
    expect(state.request).toHaveBeenCalledTimes(1)
    state.reviewConfirmed.value = true
    state.request.mockResolvedValueOnce({ campaign: { ...campaign, status: 'running' } })
    await state.approveCampaign()
    expect(state.request).toHaveBeenLastCalledWith('/api/admin/organizations/organization%2Fid/events/event%2Fid/campaigns/campaign%2Fid/approve', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: { approve: true, previewHash: 'hash' },
    })
    expect(state.currentCampaign.value?.status).toBe('running')
    expect(state.preview.value).toBeNull()
  })

  it('gera a prévia para um horário futuro no fuso do evento e aprova como agendada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'))
    const state = setup()
    state.setSendTiming('scheduled')
    state.setScheduledLocal('2026-10-19T10:00')
    state.request.mockResolvedValueOnce({
      campaign: { ...campaign, scheduledAt: '2026-10-19T14:00:00.000Z' },
      preview,
    })
    await state.createPreview()
    expect(state.request).toHaveBeenCalledExactlyOnceWith('/api/admin/organizations/organization%2Fid/events/event%2Fid/campaigns', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: {
        invitationIds: ['invitation-1'], intervalMs: 5000, scheduledAt: '2026-10-19T14:00:00.000Z',
      },
    })
    state.reviewConfirmed.value = true
    state.request.mockResolvedValueOnce({ campaign: { ...campaign, status: 'scheduled', scheduledAt: '2026-10-19T14:00:00.000Z' } })
    await state.approveCampaign()
    expect(state.currentCampaign.value?.status).toBe('scheduled')
  })

  it('não prepara agendamento vazio, inválido ou no passado', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'))
    const state = setup()
    state.setSendTiming('scheduled')
    expect(state.blockers.value).toContain('Informe a data e a hora do agendamento.')
    state.setScheduledLocal('2026-10-17T07:00')
    expect(state.blockers.value).toContain('O agendamento deve ficar no futuro.')
    await state.createPreview()
    expect(state.request).not.toHaveBeenCalled()
  })

  it('bloqueia agendamento cuja última tentativa alcança o prazo de resposta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'))
    const state = setup()
    const secondGuest = { ...guest, id: 'guest-2', name: 'Segundo contato' }
    state.invitations.value.push({ ...invitation, id: 'invitation-2', guestId: secondGuest.id,
      expiresAt: '2026-10-20T16:00:00.000Z' })
    state.selectGuest(secondGuest, true)
    state.setInterval(60_000)
    state.setSendTiming('scheduled')
    state.setScheduledLocal('2026-10-20T11:59')
    expect(state.latestSafeStart.value).toBe('2026-10-20T15:59:00.000Z')
    expect(state.blockers.value).toContain('O lote terminaria no prazo de resposta. Agende o início para antes do limite seguro.')
    state.setScheduledLocal('2026-10-20T11:58')
    expect(state.blockers.value).not.toContain('O lote terminaria no prazo de resposta. Agende o início para antes do limite seguro.')
  })

  it('invalida a revisão ao mudar seleção/cadência e ao receber conflito do servidor', async () => {
    const state = setup()
    state.request.mockResolvedValueOnce({ campaign, preview })
    await state.createPreview()
    state.reviewConfirmed.value = true
    state.setInterval(6000)
    expect(state.preview.value).toBeNull()
    expect(state.reviewConfirmed.value).toBe(false)
    state.request.mockResolvedValueOnce({ campaign: { ...campaign, intervalMs: 6000 }, preview: { ...preview, intervalMs: 6000 } })
    await state.createPreview()
    state.reviewConfirmed.value = true
    state.request.mockRejectedValueOnce({ statusCode: 409 })
    await state.approveCampaign()
    expect(state.preview.value).toBeNull()
    expect(state.error.value).toContain('mudou')
  })

  it('não usa prévia que voltou depois de trocar a seleção ou organização', async () => {
    const state = setup()
    let release!: (value: unknown) => void
    state.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const preparing = state.createPreview()
    state.organizationId.value = 'other'
    state.resetCampaigns()
    release({ campaign, preview })
    await preparing
    expect(state.preview.value).toBeNull()
    expect(state.currentCampaign.value).toBeNull()
  })

  it('retoma somente campanha pausada após nova confirmação humana', async () => {
    const state = setup()
    state.currentCampaign.value = { ...campaign, status: 'paused', counts: { uncertain: 1 } }
    await state.resumeCampaign()
    expect(state.request).not.toHaveBeenCalled()
    state.resumeConfirmed.value = true
    state.request.mockResolvedValueOnce({ campaign: { ...campaign, status: 'running' } })
    await state.resumeCampaign()
    expect(state.request).toHaveBeenCalledWith(expect.stringContaining('/resume'), {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: {},
    })
    expect(state.resumeConfirmed.value).toBe(false)
    expect(state.currentCampaign.value?.counts).toEqual({ uncertain: 1 })
  })

  it('cancela definitivamente somente após confirmação explícita', async () => {
    const state = setup()
    state.currentCampaign.value = { ...campaign, status: 'scheduled', scheduledAt: '2099-01-01T12:00:00.000Z' }
    await state.cancelCampaign()
    expect(state.request).not.toHaveBeenCalled()
    state.cancelConfirmed.value = true
    state.request.mockResolvedValueOnce({ campaign: { ...state.currentCampaign.value, status: 'cancelled', cancelledAt: '2026-10-17T12:00:00.000Z' } })
    await state.cancelCampaign()
    expect(state.request).toHaveBeenCalledWith(expect.stringContaining('/campaign%2Fid/cancel'), {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: {},
    })
    expect(state.currentCampaign.value?.status).toBe('cancelled')
    expect(state.cancelConfirmed.value).toBe(false)
  })

  it('reabre rascunho pela prévia factual sem carregar uma aprovação anterior', async () => {
    const state = setup()
    state.currentCampaign.value = campaign
    state.reviewConfirmed.value = true
    state.request.mockResolvedValueOnce({ campaign, preview })
    await state.reopenDraft()
    expect(state.request).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/campaign%2Fid/preview'))
    expect(state.preview.value).toEqual(preview)
    expect(state.selectedGuests.value).toMatchObject([{ id: guest.id, whatsappConsent: true }])
    expect(state.reviewConfirmed.value).toBe(false)
  })

  it('prepara somente convites ausentes e preserva o progresso para uma repetição', async () => {
    const state = setup()
    const other = { ...guest, id: 'guest-2', name: 'Segundo contato de teste' }
    state.selectGuest(other, true)
    state.request.mockResolvedValueOnce({ invitation: { ...invitation, id: 'invitation-2', guestId: other.id } })
    await state.prepareInvitations()
    await state.prepareInvitations()
    expect(state.request).toHaveBeenCalledExactlyOnceWith('/api/admin/organizations/organization%2Fid/events/event%2Fid/invitations', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: { guestId: other.id },
    })
    expect(state.invitations.value).toHaveLength(2)
  })

  it('ignora os dados recebidos depois que a organização foi trocada', async () => {
    const state = setup()
    let release!: (value: unknown) => void
    state.request.mockReturnValue(new Promise(resolve => { release = resolve }))
    const pending = state.loadCampaignData()
    state.organizationId.value = 'other'
    state.resetCampaigns()
    release({})
    await pending
    expect(state.guests.value).toEqual([])
    expect(state.campaigns.value).toEqual([])
    expect(state.connection.value).toBeNull()
    expect(state.busy.value).toBe(false)
  })
})
