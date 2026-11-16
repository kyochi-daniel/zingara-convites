import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDeliveries, type DeliveryEvent } from './useDeliveries'

function ref<T>(value: T) {
  return { value }
}

function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', <T>(getter: () => T) => ({ get value() { return getter() } }))
  const activeArea = ref('events')
  const state = useDeliveries({
    selectedOrganizationId: ref('organization/id'),
    csrfToken: ref('csrf-token'),
    activeArea,
  })
  return { request, activeArea, ...state }
}

const event: DeliveryEvent = {
  id: 'event/id',
  name: 'Celebração',
  rsvpDeadline: '2026-11-10T23:00:00.000Z',
  timeZone: 'America/Campo_Grande',
  publishedTemplateVersion: 1,
}

afterEach(() => vi.unstubAllGlobals())

describe('delivery administration', () => {
  it('blocks review before the invitation is published', async () => {
    const state = setup()

    await state.openDeliveryPanel({ ...event, publishedTemplateVersion: undefined })

    expect(state.activeArea.value).toBe('deliveries')
    expect(state.request).not.toHaveBeenCalled()
    expect(state.deliveryError.value).toContain('Publique o convite')
  })

  it('loads eligible invitations and delivery history with encoded paths', async () => {
    const state = setup()
    state.request
      .mockResolvedValueOnce({
        items: [
          { id: 'eligible', guestName: 'Ana', responseStatus: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' },
          { id: 'accepted', guestName: 'Bia', responseStatus: 'accepted', expiresAt: '2099-01-01T00:00:00.000Z' },
        ],
      })
      .mockResolvedValueOnce({ items: [{ id: 'delivery-1', invitationId: 'eligible' }] })

    await state.openDeliveryPanel(event)

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/events/event%2Fid/invitations')
    expect(state.request).toHaveBeenNthCalledWith(2, '/api/admin/organizations/organization%2Fid/events/event%2Fid/deliveries')
    expect(state.eligibleDeliveryInvitations.value.map(item => item.id)).toEqual(['eligible'])
    expect(state.deliveryInvitationId.value).toBe('eligible')
  })

  it('approves only a confirmed fake preview with current consent and CSRF', async () => {
    const state = setup()
    state.deliveryEvent.value = event
    state.deliveryInvitationId.value = 'invitation/id'
    state.deliveryPreviewInvitationId.value = 'invitation/id'
    state.deliveryApprovalConfirmed.value = true
    state.deliveryPreview.value = {
      recipient: { name: 'Ana', phone: '+5567999999999', whatsappConsent: true },
      text: 'Convite',
      link: 'https://example.test/i/token',
      template: {} as never,
      renderData: {},
      mode: 'fake',
      previewHash: 'preview-hash',
    }
    state.request
      .mockResolvedValueOnce({ delivery: { id: 'delivery-1' } })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    await state.approveFakeDelivery()

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/events/event%2Fid/deliveries', {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf-token' },
      body: { invitationId: 'invitation/id', approve: true, previewHash: 'preview-hash' },
    })
    expect(state.deliveryPreview.value).toBeNull()
    expect(state.deliveryNotice.value).toContain('Aprovação simulada registrada')
  })

  it('does not approve real mode or missing consent', async () => {
    const state = setup()
    state.deliveryEvent.value = event
    state.deliveryInvitationId.value = 'invitation-1'
    state.deliveryPreviewInvitationId.value = 'invitation-1'
    state.deliveryApprovalConfirmed.value = true
    state.deliveryPreview.value = {
      recipient: { name: 'Ana', phone: '+5567999999999', whatsappConsent: false },
      text: 'Convite',
      link: 'https://example.test/i/token',
      template: {} as never,
      renderData: {},
      mode: 'real',
      previewHash: 'preview-hash',
    }

    await state.approveFakeDelivery()

    expect(state.request).not.toHaveBeenCalled()
  })
})
