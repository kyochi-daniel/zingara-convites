import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEvents } from './useEvents'

function ref<T>(value: T) { return { value } }
function reactive<T extends object>(value: T) { return value }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }

afterEach(() => vi.unstubAllGlobals())

describe('event data', () => {
  it('creates an event with Campo Grande as the default time zone', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ event: { id: 'event-1' } })
      .mockResolvedValueOnce({ items: [] })
    vi.stubGlobal('$fetch', request)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('computed', computed)
    const state = useEvents({
      events: ref([]), selectedOrganizationId: ref('org/id'), csrfToken: ref('csrf'), error: ref(''), notice: ref(''), saving: ref(false),
      loadDashboardTotals: vi.fn(),
    })
    Object.assign(state.eventForm, {
      name: 'Evento', location: 'Local', address: 'Endereço', startsAt: '2027-01-15T18:00',
      endsAt: '2027-01-15T22:00', rsvpDeadline: '2027-01-12T20:00',
    })

    await state.saveEvent()

    expect(request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/org%2Fid/events', expect.objectContaining({
      method: 'POST', body: expect.objectContaining({ timeZone: 'America/Campo_Grande' }),
    }))
    expect(state.eventForm.timeZone).toBe('America/Campo_Grande')
  })

  it('revises a published RSVP deadline in the event time zone', async () => {
    const event = {
      id: 'event-1', name: 'Festival de Exemplo', location: 'Zingara', address: 'Rua Exemplo, 123',
      startsAt: '2026-10-31T20:00:00.000Z', endsAt: '2026-11-01T01:00:00.000Z',
      rsvpDeadline: '2026-10-29T20:00:00.000Z', timeZone: 'America/Campo_Grande',
      companionLimit: 0, companionNamesRequired: false, status: 'published', revision: 1,
    }
    const request = vi.fn().mockResolvedValue({ event: { ...event, revision: 2 } })
    vi.stubGlobal('$fetch', request)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('computed', computed)
    const state = useEvents({
      events: ref([event]), selectedOrganizationId: ref('org-1'), csrfToken: ref('csrf'), error: ref(''), notice: ref(''), saving: ref(false),
      loadDashboardTotals: vi.fn(),
    })

    state.openPublishedEventRevision(event)

    expect(state.publishedEventForm.rsvpDeadline).toBe('2026-10-29T16:00')
    await state.revisePublishedEvent(event)
    expect(request).toHaveBeenCalledWith('/api/admin/organizations/org-1/events/event-1/revise', expect.objectContaining({
      method: 'PUT',
      body: expect.objectContaining({
        changes: expect.objectContaining({ rsvpDeadline: '2026-10-29T16:00:00-04:00' }),
      }),
    }))
  })
})
