import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEvolutionConsole } from './useEvolutionConsole'

function ref<T>(value: T) { return { value } }

function setup() {
  const request = vi.fn()
  const selectedOrganizationId = ref('organization/id')
  const csrfToken = ref('csrf-token')
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('onScopeDispose', vi.fn())
  return {
    request,
    selectedOrganizationId,
    ...useEvolutionConsole({ selectedOrganizationId, csrfToken }),
  }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function pairingSetup() {
  vi.useFakeTimers()
  const state = setup()
  state.inventory.value = [{ instanceName: 'zingara-own', channel: 'baileys', state: 'disconnected', localState: 'ready', ownership: 'propria', connectionId: 'local-id' }]
  state.request.mockImplementation((path: string) => Promise.resolve({ status: path.endsWith('/connect')
    ? { state: 'connecting', qrCode: 'current-qr' } : { state: 'connecting' } }))
  return state
}

describe('Evolution pairing window', () => {
  it('fetches the current provider QR automatically and detects connection', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    state.request.mockResolvedValueOnce({ status: { state: 'connecting' } })
      .mockResolvedValueOnce({ status: { state: 'connecting', qrCode: 'new-provider-qr' } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.statuses.value['local-id']?.qrCode).toBe('new-provider-qr')
    expect(state.pairing.value?.remainingSeconds).toBe(295)
    state.request.mockResolvedValue({ status: { state: 'connected' } })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.pairing.value).toBeNull()
    expect(state.statuses.value['local-id']).toEqual({ state: 'connected' })
    expect(state.notice.value).toContain('Telefone conectado')
    const count = state.request.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state.request).toHaveBeenCalledTimes(count)
  })

  it('keeps the QR during manual diagnosis while pairing', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    await state.diagnoseEvolution('local-id')
    expect(state.statuses.value['local-id']?.qrCode).toBe('current-qr')
  })

  it('does not replace confirmed connection with a late manual diagnosis', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    let resolve: (value: unknown) => void = () => {}
    state.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const diagnosis = state.diagnoseEvolution('local-id')
    state.request.mockResolvedValue({ status: { state: 'connected' } })
    await vi.advanceTimersByTimeAsync(5_000)
    resolve({ status: { state: 'connecting' } })
    await diagnosis
    expect(state.statuses.value['local-id']?.state).toBe('connected')
  })

  it('ends after five minutes and removes the QR without claiming its validity', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    await vi.advanceTimersByTimeAsync(300_000)
    expect(state.pairing.value).toBeNull()
    expect(state.statuses.value['local-id']?.qrCode).toBeUndefined()
    expect(state.notice.value).toContain('cinco minutos')
    const count = state.request.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(state.request).toHaveBeenCalledTimes(count)
  })

  it('discards an in-flight QR when the organization changes', async () => {
    const state = pairingSetup()
    let resolve: (value: unknown) => void = () => {}
    state.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const connecting = state.connectEvolution('local-id')
    state.selectedOrganizationId.value = 'other'
    state.resetEvolutionOrganization()
    resolve({ status: { state: 'connecting', qrCode: 'old-organization-qr' } })
    await connecting
    await vi.advanceTimersByTimeAsync(10_000)
    expect(state.statuses.value).toEqual({})
    expect(state.pairing.value).toBeNull()
    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('stops and clears the QR when the provider fails', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    state.request.mockRejectedValue(new Error('unavailable'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.pairing.value).toBeNull()
    expect(state.statuses.value['local-id']?.qrCode).toBeUndefined()
    expect(state.error.value).toContain('pareamento')
  })

  it('discards a pending QR after the window ends', async () => {
    const state = pairingSetup()
    let resolve: (value: unknown) => void = () => {}
    state.request.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const connecting = state.connectEvolution('local-id')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.pairing.value?.remainingSeconds).toBe(295)
    await vi.advanceTimersByTimeAsync(295_000)
    resolve({ status: { state: 'connecting', qrCode: 'late-qr' } })
    await connecting
    expect(state.pairing.value).toBeNull()
    expect(state.statuses.value['local-id']?.qrCode).toBeUndefined()
    expect(state.notice.value).toContain('cinco minutos')
  })

  it('stops timers on scope disposal and manual cancellation', async () => {
    const state = pairingSetup()
    await state.connectEvolution('local-id')
    const dispose = vi.mocked(onScopeDispose).mock.calls[0]![0]
    dispose()
    expect(state.pairing.value).toBeNull()
    expect(state.statuses.value['local-id']?.qrCode).toBeUndefined()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('never starts pairing for protected, Cloud or disabled instances', async () => {
    const state = pairingSetup()
    await state.connectEvolution('foreign-id')
    state.inventory.value[0]!.channel = 'cloud'
    await state.connectEvolution('local-id')
    state.inventory.value[0]!.channel = 'baileys'
    state.installation.value = { baseUrl: 'https://evolution.test', verifiedAt: '', controlEnabled: false }
    await state.connectEvolution('local-id')
    expect(state.request).not.toHaveBeenCalled()
  })
})

describe('Evolution console data', () => {
  it('loads installation, inventory, active connection and owned instance details', async () => {
    const state = setup()
    state.request.mockImplementation((path: string) => {
      if (path === '/api/admin/evolution/installation') return Promise.resolve({ installation: { baseUrl: 'https://evolution.test', verifiedAt: '2026-10-10T00:00:00.000Z' } })
      if (path.endsWith('/instances')) return Promise.resolve({ instances: [
        { instanceName: 'foreign', channel: 'baileys', state: 'connected', ownership: 'protegida' },
        { instanceName: 'zingara-own', channel: 'cloud', state: 'connected', localState: 'ready', ownership: 'propria', connectionId: 'local-id' },
      ] })
      if (path.endsWith('/connections/active')) return Promise.resolve({ active: { provider: 'evolution', channel: 'cloud', connectionId: 'local-id', revision: 1 } })
      if (path.endsWith('/local-id/status')) return Promise.resolve({ status: { state: 'connected', mode: 'fake' } })
      if (path.endsWith('/local-id/templates')) return Promise.resolve({ templates: [{ type: 'initial', name: 'invite', language: 'pt_BR', status: 'approved' }] })
      throw new Error(`Unexpected request: ${path}`)
    })

    await state.loadEvolutionArea()

    expect(state.installation.value?.baseUrl).toBe('https://evolution.test')
    expect(state.inventory.value).toHaveLength(2)
    expect(state.activeConnection.value?.connectionId).toBe('local-id')
    expect(state.statuses.value['local-id']?.state).toBe('connected')
    expect(state.templates.value['local-id']).toHaveLength(1)
  })

  it('keeps installation credentials out of the browser contract', () => {
    const state = setup()

    expect('saveEvolutionInstallation' in state).toBe(false)
  })

  it('links an existing instance through the organization-scoped route', async () => {
    const state = setup()
    const data = { channel: 'baileys' as const, instanceName: 'zingara-existing', token: 'instance-token', confirm: true as const }
    state.request
      .mockResolvedValueOnce({ connection: { id: 'local-id' } })
      .mockResolvedValueOnce({ installation: null })
      .mockRejectedValueOnce(new Error('not configured'))

    await state.linkEvolutionConnection(data)

    expect(state.request).toHaveBeenNthCalledWith(1, '/api/admin/organizations/organization%2Fid/connections/evolution/link', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf-token' }, body: data,
    })
    expect(state.notice.value).toBe('Instância vinculada à organização sem alterar a sessão remota.')
  })

  it('keeps an empty console when backend configuration is missing', async () => {
    const state = setup()
    state.request.mockResolvedValue({ installation: null })

    await state.loadEvolutionArea()

    expect(state.request).toHaveBeenCalledTimes(1)
    expect(state.inventory.value).toEqual([])
    expect(state.error.value).toBe('')
  })

  it('discards inventory returned after the selected organization changes', async () => {
    const state = setup()
    let resolveInventory: ((value: unknown) => void) | undefined
    state.request.mockImplementation((path: string) => {
      if (path === '/api/admin/evolution/installation') return Promise.resolve({ installation: { baseUrl: 'https://evolution.test', verifiedAt: '2026-10-10T00:00:00.000Z' } })
      if (path.endsWith('/instances')) return new Promise(resolve => { resolveInventory = resolve })
      if (path.endsWith('/connections/active')) return Promise.resolve({ active: null })
      throw new Error(`Unexpected request: ${path}`)
    })

    const loading = state.loadEvolutionArea()
    await Promise.resolve()
    await Promise.resolve()
    state.selectedOrganizationId.value = 'other-organization'
    resolveInventory?.({ instances: [{ instanceName: 'stale', channel: 'baileys', state: 'connected', ownership: 'protegida' }] })
    await loading

    expect(state.inventory.value).toEqual([])
  })

  it('clears authenticated state when a refresh cannot reach Evolution', async () => {
    const state = setup()
    state.request.mockImplementation((path: string) => {
      if (path === '/api/admin/evolution/installation') return Promise.resolve({ installation: { baseUrl: 'https://evolution.test', verifiedAt: '2026-10-10T00:00:00.000Z' } })
      if (path.endsWith('/instances')) return Promise.resolve({ instances: [
        { instanceName: 'foreign', channel: 'baileys', state: 'connected', ownership: 'protegida' },
      ] })
      if (path.endsWith('/connections/active')) return Promise.resolve({ active: null })
      throw new Error(`Unexpected request: ${path}`)
    })
    await state.loadEvolutionArea()
    state.request.mockRejectedValue(new Error('remote unavailable'))

    await state.loadEvolutionArea()

    expect(state.installation.value).toBeNull()
    expect(state.inventory.value).toEqual([])
    expect(state.activeConnection.value).toBeNull()
    expect(state.statuses.value).toEqual({})
    expect(state.templates.value).toEqual({})
    expect(state.error.value).toBe('Não foi possível conectar à Evolution. Atualize a tela.')
  })
})
