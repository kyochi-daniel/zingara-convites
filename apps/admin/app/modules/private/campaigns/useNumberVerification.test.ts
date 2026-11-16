import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNumberVerification } from './useNumberVerification'
function ref<T>(value: T) { return { value } }
function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  const connection = ref({ connectionId: 'connection/id', revision: 2, channel: 'baileys' as const })
  const organizationId = ref('organization/id')
  return { request, connection, organizationId, ...useNumberVerification({ organizationId, csrfToken: ref('csrf'), connection }) }
}
afterEach(() => vi.unstubAllGlobals())
const preview = { channel: 'baileys', lookupSupported: true, mode: 'fake', connection: { id: 'connection/id', instanceName: 'Teste', revision: 2 },
  limits: { batch: 10, perMinute: 10, perDay: 100 }, results: [{ phone: '+5567999990001', state: 'not_checked' }] }
describe('verificação factual de números', () => {
  it('exige prévia e confirmação humana e transmite no máximo dez números', async () => {
    const state = setup()
    const phones = Array.from({ length: 11 }, (_, index) => `+556799999${String(index).padStart(4, '0')}`)
    await state.verifyNumbers(phones)
    expect(state.request).not.toHaveBeenCalled()
    state.request.mockResolvedValueOnce(preview)
    await state.previewNumbers(phones)
    state.confirmed.value = true
    state.request.mockResolvedValueOnce({ ...preview, results: [{ phone: phones[0], state: 'registered', checkedAt: '2026-10-15T12:00:00Z' }] })
    await state.verifyNumbers(phones)
    expect(state.request).toHaveBeenLastCalledWith(expect.stringContaining('/numbers-verify'), {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' }, body: { phones: phones.slice(0, 10), confirm: true },
    })
    expect(state.confirmed.value).toBe(false)
  })
  it('não consulta Cloud nem transforma indisponibilidade em número inexistente', async () => {
    const state = setup()
    state.request.mockResolvedValue({ ...preview, channel: 'cloud', lookupSupported: false, results: [{ phone: '+5567999990001', state: 'unsupported' }] })
    await state.previewNumbers(['+5567999990001'])
    state.confirmed.value = true
    await state.verifyNumbers(['+5567999990001'])
    expect(state.request).toHaveBeenCalledTimes(1)
    expect(state.results.value['+5567999990001']?.state).toBe('unsupported')
  })
  it('ignora resultado que chega após mudança de conexão', async () => {
    const state = setup()
    let release!: (value: unknown) => void
    state.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const pending = state.previewNumbers(['+5567999990001'])
    state.connection.value = { ...state.connection.value, connectionId: 'other' }
    release(preview)
    await pending
    expect(state.results.value).toEqual({})
  })
})
