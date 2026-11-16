import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGuestEventStatus } from './useGuestEventStatus'

function ref<T>(value: T) {
  return { value }
}

function setup(saved?: Record<string, string>) {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', <T>(getter: () => T) => ({ get value() { return getter() } }))
  const values = new Map(Object.entries(saved ?? {}))
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
  const selectedOrganizationId = ref('organization/id')
  const events = ref([
    { id: 'test', name: 'TESTE PRIVADO', status: 'published', publishedTemplateVersion: 2 },
    { id: 'real', name: 'Celebração de Exemplo', status: 'published', publishedTemplateVersion: 1 },
    { id: 'draft', name: 'Rascunho', status: 'draft' },
    { id: 'cancelled', name: 'Cancelado', status: 'cancelled', publishedTemplateVersion: 1 },
  ])
  const state = useGuestEventStatus({ selectedOrganizationId, events, storage })
  return { request, storage, selectedOrganizationId, events, ...state }
}

afterEach(() => vi.unstubAllGlobals())

describe('guest RSVP event status', () => {
  it('requires an explicit choice when more than one published event is available', async () => {
    const state = setup()

    await state.syncGuestRsvpSelection()

    expect(state.guestRsvpEvents.value.map(event => event.id)).toEqual(['test', 'real'])
    expect(state.guestRsvpEventId.value).toBe('')
    expect(state.request).not.toHaveBeenCalled()
  })

  it('loads the selected event statuses and persists the selection per organization', async () => {
    const state = setup()
    state.request.mockResolvedValue({ items: [
      { guestId: 'guest-1', responseStatus: 'accepted' },
      { guestId: 'guest-2', responseStatus: 'pending', revokedAt: '2026-10-17T20:00:00.000Z' },
    ] })

    await state.selectGuestRsvpEvent('real')

    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/organization%2Fid/events/real/invitations')
    expect(state.guestRsvpStatusById.value).toEqual({ 'guest-1': 'accepted', 'guest-2': 'revoked' })
    expect(state.storage.setItem).toHaveBeenCalledWith('zingara:guest-rsvp-event:organization/id', 'real')
  })

  it('restores a valid saved selection without changing the dashboard event', async () => {
    const state = setup({ 'zingara:guest-rsvp-event:organization/id': 'real' })
    state.request.mockResolvedValue({ items: [] })

    await state.syncGuestRsvpSelection()

    expect(state.guestRsvpEventId.value).toBe('real')
    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('replaces the displayed statuses when the administrator changes the event', async () => {
    const state = setup()
    state.request
      .mockResolvedValueOnce({ items: [{ guestId: 'guest-1', responseStatus: 'pending' }] })
      .mockResolvedValueOnce({ items: [{ guestId: 'guest-1', responseStatus: 'accepted' }] })

    await state.selectGuestRsvpEvent('test')
    expect(state.guestRsvpStatusById.value).toEqual({ 'guest-1': 'pending' })

    await state.selectGuestRsvpEvent('real')
    expect(state.guestRsvpStatusById.value).toEqual({ 'guest-1': 'accepted' })
    expect(state.request).toHaveBeenCalledTimes(2)
  })
})
