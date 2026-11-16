import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrganizations } from './useOrganizations'

function ref<T>(value: T) { return { value } }
function reactive<T extends object>(value: T) { return value }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }

function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  const csrfToken = ref('csrf-token')
  const error = ref('')
  const notice = ref('')
  const saving = ref(false)
  return { request, error, notice, saving, ...useOrganizations({ csrfToken, error, notice, saving }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('organization data', () => {
  it('loads organizations and selects the first valid option', async () => {
    const state = setup()
    state.request.mockResolvedValue({ items: [{ id: 'org-1', name: 'Zingara' }] })

    await state.loadOrganizations()

    expect(state.selectedOrganizationId.value).toBe('org-1')
    expect(state.organizationOptions.value).toEqual([{ id: 'org-1', name: 'Zingara' }])
  })

  it('saves sanitized optional fields and reloads the list', async () => {
    const state = setup()
    Object.assign(state.organizationForm, { name: 'Zingara', primaryColor: '#123456', logoUrl: '', replyToEmail: '' })
    state.request
      .mockResolvedValueOnce({ organization: { id: 'org-1' } })
      .mockResolvedValueOnce({ items: [{ id: 'org-1', name: 'Zingara' }] })

    await state.saveOrganization()

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf-token' },
      body: { name: 'Zingara', visualIdentity: { primaryColor: '#123456' } },
    })
    expect(state.notice.value).toBe('Organização criada.')
  })
})
