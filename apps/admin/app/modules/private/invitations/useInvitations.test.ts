import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInvitations } from './useInvitations'

function ref<T>(value: T) { return { value } }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }

function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  const selectedOrganizationId = ref('org/id')
  const csrfToken = ref('csrf')
  const events = ref<any[]>([])
  const activeArea = ref('events')
  return { request, activeArea, ...useInvitations({ selectedOrganizationId, csrfToken, events, activeArea }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('invitation data', () => {
  it('opens a published event with guests and invitation totals', async () => {
    const state = setup()
    state.request
      .mockResolvedValueOnce({ items: [{ id: 'guest-1', name: 'Ana' }], total: 1 })
      .mockResolvedValueOnce({ items: [], totals: { pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 } })

    await state.openInvitations({ id: 'event-1', status: 'published', publishedTemplateVersion: 1 } as any)

    expect(state.activeArea.value).toBe('invitations')
    expect(state.invitationGuestId.value).toBe('guest-1')
    expect(state.request).toHaveBeenNthCalledWith(2, '/api/admin/organizations/org%2Fid/events/event-1/invitations')
  })

  it('does not load private invitation data for an unpublished event', async () => {
    const state = setup()

    await state.openInvitations({ id: 'draft', status: 'draft' } as any)

    expect(state.request).not.toHaveBeenCalled()
    expect(state.invitationError.value).toContain('Publique o convite')
  })
})
