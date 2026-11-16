import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGuests, type Guest } from './useGuests'

function ref<T>(value: T) {
  return { value }
}

function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', <T extends object>(value: T) => value)
  vi.stubGlobal('computed', <T>(getter: () => T) => ({ get value() { return getter() } }))
  const dashboardGuestTotal = ref(0)
  const error = ref('')
  const notice = ref('')
  const saving = ref(false)
  const guests = useGuests({
    selectedOrganizationId: ref('organization/id'),
    csrfToken: ref('csrf-token'),
    dashboardGuestTotal,
    error,
    notice,
    saving,
  })
  return { request, dashboardGuestTotal, error, notice, saving, ...guests }
}

afterEach(() => vi.unstubAllGlobals())

describe('guest administration', () => {
  it('previews a document without preselecting rows or inferring WhatsApp permission', async () => {
    const state = setup()
    state.request.mockResolvedValue({ rows: [{ line: 1, guest: { name: 'Ana', phone: '+5567999991111' }, errors: [], duplicates: [] }] })
    const file = new File(['Ana;(67) 99999-1111'], 'lista.txt')
    await state.chooseContactFile({ target: { files: [file] } } as unknown as Event)
    expect(state.request.mock.calls[0]![1].body.file.name).toBe('lista.txt')
    expect(state.acceptedRows.value).toEqual([])
    state.setAccepted(1, true)
    state.request.mockResolvedValueOnce({ created: [], reused: [] }).mockResolvedValueOnce({ items: [], total: 0 })
    await state.importCsv()
    expect(state.request.mock.calls[1]![1].body.whatsappConsent).toBe(false)
  })

  it('requires an explicit source before importing with WhatsApp permission', async () => {
    const state = setup()
    state.request.mockResolvedValue({ rows: [{ line: 1, errors: [], duplicates: [] }] })
    await state.chooseContactFile({ target: { files: [new File(['Ana;(67) 99999-1111'], 'lista.txt')] } } as unknown as Event)
    state.setAccepted(1, true)
    state.setImportAuthorization(true, '')
    await state.importCsv()
    expect(state.request).toHaveBeenCalledTimes(1)
    expect(state.error.value).toContain('fonte')
    const before = state.csvBatchId.value
    state.setImportAuthorization(true, 'Formulário presencial em 15/10/2026')
    expect(state.csvBatchId.value).not.toBe(before)
    state.request.mockResolvedValueOnce({ created: [], reused: [] }).mockResolvedValueOnce({ items: [], total: 0 })
    await state.importCsv()
    expect(state.request.mock.calls[1]![1].body).toMatchObject({ whatsappConsent: true, authorizationSource: 'Formulário presencial em 15/10/2026' })
  })
  it('loads paged contacts with encoded organization and active filters', async () => {
    const state = setup()
    state.guestPage.value = 2
    state.guestSearch.value = 'Ana'
    state.guestTag.value = 'família'
    state.request.mockResolvedValue({ items: [{ id: '1', name: 'Ana' }], total: 21 })

    await state.loadGuests()

    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/organization%2Fid/guests', {
      query: { page: 2, limit: 100, q: 'Ana', tag: 'família' },
    })
    expect(state.guests.value).toHaveLength(1)
    expect(state.guestTotal.value).toBe(21)
    expect(state.dashboardGuestTotal.value).toBe(0)
  })

  it('changes the page size, returns to the first page and reloads the list', async () => {
    const state = setup()
    state.guestPage.value = 3
    state.request.mockResolvedValue({ items: [], total: 51 })

    await state.changeGuestPageSize(100)

    expect(state.guestPage.value).toBe(1)
    expect(state.guestPageSize.value).toBe(100)
    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/organization%2Fid/guests', {
      query: { page: 1, limit: 100 },
    })
  })

  it('removes stale rows while a filtered request is loading and keeps them cleared on failure', async () => {
    const state = setup()
    state.guests.value = [{ id: 'old', name: 'Lista anterior', phone: '+5567999999999', tags: [], notes: '' }]
    state.guestTag.value = 'lista-evento-exemplo'
    state.request.mockRejectedValue(new Error('proxy'))

    const loading = state.loadGuests()

    expect(state.guests.value).toEqual([])
    expect(state.guestLoading.value).toBe(true)
    await loading
    expect(state.guests.value).toEqual([])
    expect(state.guestTotal.value).toBe(0)
    expect(state.guestLoading.value).toBe(false)
    expect(state.error.value).toBe('Não foi possível carregar os contatos.')
  })

  it('saves the edited contact and reloads the first page', async () => {
    const state = setup()
    const guest: Guest = {
      id: 'guest/id', name: 'Ana', phone: '+5567999999999', email: 'ana@example.test',
      tags: ['família', 'vip'], notes: 'Mesa 2', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado',
    }
    state.editGuest(guest)
    state.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ items: [guest], total: 1 })

    await state.saveGuest()

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/guests/guest%2Fid', {
      method: 'PATCH',
      headers: { 'x-csrf-token': 'csrf-token' },
      body: {
        name: 'Ana', phone: '+5567999999999', email: 'ana@example.test', tags: ['família', 'vip'],
        notes: 'Mesa 2', whatsappConsent: true, authorizationSource: 'Formulário presencial assinado',
      },
    })
    expect(state.guestPage.value).toBe(1)
    expect(state.editingGuestId.value).toBeNull()
    expect(state.notice.value).toBe('Contato atualizado.')
  })

  it('previews a CSV and changes the idempotency key when selection changes', async () => {
    const state = setup()
    state.request.mockResolvedValue({ rows: [{ line: 2, errors: [], duplicates: [] }] })
    const file = new File(['name,phone\nAna,+5567999999999'], 'guests.csv', { type: 'text/csv' })

    await state.chooseCsv({ target: { files: [file] } } as unknown as Event)
    const firstBatch = state.csvBatchId.value
    state.setAccepted(2, true)

    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/organization%2Fid/guests/preview', {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf-token' },
      body: { csv: 'name,phone\nAna,+5567999999999' },
    })
    expect(state.csvName.value).toBe('guests.csv')
    expect(state.acceptedRows.value).toEqual([2])
    expect(state.csvBatchId.value).not.toBe(firstBatch)
  })

  it('rejects an oversized CSV before calling the API', async () => {
    const state = setup()
    const file = new File(['x'.repeat(16_384)], 'large.csv', { type: 'text/csv' })

    await state.chooseCsv({ target: { files: [file] } } as unknown as Event)

    expect(state.request).not.toHaveBeenCalled()
    expect(state.error.value).toBe('O arquivo ultrapassa o limite de 16 KiB.')
  })

  it('imports the selected rows with the current idempotency key', async () => {
    const state = setup()
    state.csvText.value = 'name,phone\nAna,+5567999999999'
    state.csvBatchId.value = 'batch-id'
    state.acceptedRows.value = [4, 2]
    state.request
      .mockResolvedValueOnce({ created: [{ id: '1' }, { id: '2' }] })
      .mockResolvedValueOnce({ items: [], total: 2 })

    await state.importCsv()

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/guests/import', {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf-token' },
      body: {
        csv: 'name,phone\nAna,+5567999999999',
        acceptedRows: [2, 4],
        batchId: 'batch-id',
      },
    })
    expect(state.dashboardGuestTotal.value).toBe(2)
    expect(state.notice.value).toBe('2 contatos confirmados na importação.')
    expect(state.importing.value).toBe(false)
  })
})
