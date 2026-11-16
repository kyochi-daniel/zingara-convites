import { defaultTemplate } from '@zingara/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePublicInvitation } from './usePublicInvitation'

function ref<T>(value: T) {
  return { value }
}

function invitation() {
  return {
    guest: { name: 'Ana' },
    event: {
      name: 'Celebração',
      location: 'Salão',
      address: 'Rua Um, 1',
      startsAt: '2026-10-29T13:00:00.000Z',
      timeZone: 'America/Campo_Grande',
    },
    template: { ...defaultTemplate, imageAssetId: 'a'.repeat(32) },
    response: { status: 'pending' as const, companions: [], version: 3 },
    companionLimit: 2,
    companionNamesRequired: true,
    rsvpDeadline: '2099-10-28T23:59:00.000Z',
    expiresAt: '2099-10-30T23:59:00.000Z',
  }
}

function setup() {
  const request = vi.fn() as ReturnType<typeof vi.fn> & { raw: ReturnType<typeof vi.fn> }
  request.raw = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', <T>(getter: () => T) => ({ get value() { return getter() } }))
  vi.stubGlobal('onMounted', vi.fn())
  vi.stubGlobal('onUnmounted', vi.fn())
  vi.stubGlobal('watch', vi.fn())
  vi.stubGlobal('nextTick', vi.fn().mockResolvedValue(undefined))
  return { request, state: usePublicInvitation(ref('token/with spaces')) }
}

afterEach(() => vi.unstubAllGlobals())

describe('public invitation', () => {
  it('loads the token without cache and keeps the CSRF token outside the URL', async () => {
    const { request, state } = setup()
    request.raw.mockResolvedValue({
      _data: { invitation: invitation() },
      headers: new Headers({ 'x-rsvp-csrf': 'csrf-token' }),
    })

    await state.loadInvitation()

    expect(request.raw).toHaveBeenCalledWith('/api/public/invitations/token%2Fwith%20spaces', { cache: 'no-store' })
    expect(state.invitation.value?.guest.name).toBe('Ana')
    expect(state.imageUrl.value).toBe(`/media/${'a'.repeat(32)}`)
    expect(state.values.value).toMatchObject({
      'convidado.nome': 'Ana',
      'evento.nome': 'Celebração',
      'evento.local': 'Salão',
      'convite.limite_acompanhantes': 2,
    })
  })

  it('validates companion names before submitting a response', async () => {
    const { request, state } = setup()
    state.invitation.value = invitation()
    state.answer.value = 'accepted'
    state.companions.value = [' ']

    await state.saveResponse()

    expect(request).not.toHaveBeenCalled()
    expect(state.formError.value).toBe('Preencha o nome de cada acompanhante.')
  })

  it('submits the expected version and CSRF token', async () => {
    const { request, state } = setup()
    request.raw.mockResolvedValue({
      _data: { invitation: invitation() },
      headers: new Headers({ 'x-rsvp-csrf': 'csrf-token' }),
    })
    await state.loadInvitation()
    state.answer.value = 'accepted'
    state.companions.value = [' Bia ']
    request.mockResolvedValue({
      response: { status: 'accepted', companions: ['Bia'], version: 4, respondedAt: '2026-10-10T12:00:00.000Z', peopleCount: 2 },
    })

    await state.saveResponse()

    expect(request).toHaveBeenCalledWith('/api/public/invitations/token%2Fwith%20spaces/rsvp', {
      method: 'PUT',
      headers: { 'x-rsvp-csrf': 'csrf-token' },
      body: { status: 'accepted', companions: ['Bia'], expectedVersion: 3 },
    })
    expect(state.notice.value).toBe('Presença confirmada para 2 pessoas.')
  })

  it('shows an unavailable state for a missing invitation', async () => {
    const { request, state } = setup()
    request.raw.mockRejectedValue({ statusCode: 404 })

    await state.loadInvitation()

    expect(state.unavailable.value).toBe(true)
    expect(state.loadError.value).toBe('')
  })
})
