import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvolutionClient, createEvolutionInstallationClient, proveEvolutionInstance, EvolutionHttpError, EvolutionUncertainError } from '../packages/integrations/src/index'

const base = { baseUrl: 'https://evolution.example', instanceName: 'zingara-test-123', token: 'instance-secret', mode: 'real' as const }
const calls: { url: string; init: RequestInit }[] = []
function reply(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); calls.length = 0 })

describe('Evolution 2.3.7', () => {
  it('rejects ambiguous number lookup responses instead of trusting the first entry', async () => {
    reply([{ number: '5567999999999', exists: true }, { number: '5567999999998', exists: true }])
    await expect(createEvolutionClient({ ...base, channel: 'baileys' }).checkNumber('+5567999999999'))
      .rejects.toThrow('Resposta Evolution de número inválida')
  })
  it('lists every instance with the global key and strips remote secrets', async () => {
    reply([{ name: 'other-app', integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open', ownerJid: '5567999999999@s.whatsapp.net', token: 'secret', qrcode: 'secret' },
      { name: base.instanceName, integration: 'WHATSAPP-BUSINESS', connectionStatus: 'close', number: '12345678901', apiKey: 'secret' }])
    const client = createEvolutionInstallationClient({ baseUrl: base.baseUrl, adminApiKey: 'global-secret', mode: 'real' })
    expect(await client.listInstances()).toEqual([
      { instanceName: 'other-app', channel: 'baileys', state: 'connected', maskedNumber: '••••9999' },
      { instanceName: base.instanceName, channel: 'cloud', state: 'disconnected', maskedNumber: '••••8901' },
    ])
    expect(calls[0]?.url).toBe('https://evolution.example/instance/fetchInstances')
    expect(calls[0]?.init.headers).toMatchObject({ apikey: 'global-secret' })
    expect(calls[0]?.init.redirect).toBe('error')
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('verifies the global key through the global-only endpoint', async () => {
    reply({ status: 200, facebookUserToken: 'remote-secret' })
    const client = createEvolutionInstallationClient({ baseUrl: base.baseUrl, adminApiKey: 'global-secret', mode: 'real' })
    expect(await client.verify()).toBeUndefined()
    expect(calls[0]?.url).toBe('https://evolution.example/verify-creds')
    expect(calls[0]?.init.method).toBe('POST')
    reply({ error: 'global-secret' }, 401)
    await expect(client.verify()).rejects.toMatchObject({ status: 401, message: 'Evolution HTTP 401' })
  })

  it('rejects malformed inventory and does not leak an upstream error body', async () => {
    reply([{ name: ' valid ', integration: 'WHATSAPP-BAILEYS' }])
    const client = createEvolutionInstallationClient({ baseUrl: base.baseUrl, adminApiKey: 'global-secret', mode: 'real' })
    await expect(client.listInstances()).rejects.toThrow('Inventário Evolution inválido')
    reply({ error: 'global-secret' }, 401)
    await expect(client.listInstances()).rejects.toMatchObject({ status: 401, message: 'Evolution HTTP 401' })
  })

  it('cancels a chunked response as soon as it exceeds 1 MiB', async () => {
    let chunks = 0
    let cancelled = false
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024))
        if (++chunks === 20) controller.close()
      },
      cancel() { cancelled = true },
    }), { status: 200 })))
    const client = createEvolutionInstallationClient({ baseUrl: base.baseUrl, adminApiKey: 'global-secret', mode: 'real' })
    await expect(client.listInstances()).rejects.toThrow('Resposta Evolution excede limite')
    expect(chunks).toBeLessThan(20)
    expect(cancelled).toBe(true)
  })

  it('keeps oversized chunked send responses uncertain', async () => {
    let cancelled = false
    let chunks = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(256 * 1024))
        if (++chunks === 20) controller.close()
      },
      cancel() { cancelled = true },
    }), { status: 201 })))
    vi.stubEnv('EVOLUTION_REAL_SEND_ENABLED', '1')
    const client = createEvolutionClient({ ...base, channel: 'baileys', realSendEnabled: true, allowedDestinations: ['5567999999999'] })
    await expect(client.sendText({ number: '5567999999999', text: 'Teste' })).rejects.toBeInstanceOf(EvolutionUncertainError)
    expect(chunks).toBeLessThan(20)
    expect(cancelled).toBe(true)
  })

  it('proves exactly one identity through an unfiltered instance-token lookup', async () => {
    reply([{ name: 'legacy-zingara', integration: 'WHATSAPP-BAILEYS', connectionStatus: 'open' }])
    expect(await proveEvolutionInstance({ baseUrl: base.baseUrl, instanceName: 'legacy-zingara', token: 'instance-secret', mode: 'real' }))
      .toEqual({ instanceName: 'legacy-zingara', channel: 'baileys', state: 'connected' })
    expect(calls[0]?.url).toBe('https://evolution.example/instance/fetchInstances')
    expect(calls[0]?.init.headers).toMatchObject({ apikey: 'instance-secret' })
    reply([{ name: 'legacy-zingara', integration: 'WHATSAPP-BAILEYS' }, { name: 'foreign', integration: 'WHATSAPP-BAILEYS' }])
    await expect(proveEvolutionInstance({ baseUrl: base.baseUrl, instanceName: 'legacy-zingara', token: 'instance-secret', mode: 'real' }))
      .rejects.toThrow('Identidade Evolution divergente')
    reply([{ name: 'other', integration: 'WHATSAPP-BAILEYS' }])
    await expect(proveEvolutionInstance({ baseUrl: base.baseUrl, instanceName: 'legacy-zingara', token: 'instance-secret', mode: 'real' }))
      .rejects.toThrow('Identidade Evolution divergente')
  })

  it('rejects an unsafe origin before any installation call', async () => {
    for (const baseUrl of ['http://localhost', 'https://user:pass@evolution.example', 'https://evolution.example/path', 'https://evolution.example\\@evil.example']) {
      expect(() => createEvolutionInstallationClient({ baseUrl, adminApiKey: 'global-secret', mode: 'real' })).toThrow('URL Evolution inválida')
    }
    expect(calls).toHaveLength(0)
  })
  it('creates only the reserved instance with the global key and normalizes the response', async () => {
    reply({ instance: { instanceName: base.instanceName, instanceId: 'id', integration: 'WHATSAPP-BAILEYS', status: 'close' }, hash: base.token })
    const client = createEvolutionClient({ ...base, adminApiKey: 'global-secret', channel: 'baileys' })
    expect(await client.createInstance()).toEqual({ instanceName: base.instanceName, instanceId: 'id', channel: 'baileys', state: 'disconnected' })
    expect(calls[0]?.url).toBe('https://evolution.example/instance/create')
    expect(calls[0]?.init.headers).toMatchObject({ apikey: 'global-secret' })
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ instanceName: base.instanceName, integration: 'WHATSAPP-BAILEYS', token: base.token, qrcode: false })
  })

  it('checks an uncreated instance with the global key and keeps ownership checks scoped', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      const key = (init.headers as Record<string, string>).apikey
      if (key === 'global-secret') return new Response('[]', { status: 200 })
      return new Response('{}', { status: 401 })
    }))
    const client = createEvolutionClient({ ...base, adminApiKey: 'global-secret', channel: 'baileys' })
    expect(await client.getInstanceAsAdmin()).toBeNull()
    await expect(client.getInstance()).rejects.toMatchObject({ status: 401 })
    expect(calls.map(call => (call.init.headers as Record<string, string>).apikey))
      .toEqual(['global-secret', base.token])
    expect(calls.every(call => call.url.endsWith(`/instance/fetchInstances?instanceName=${base.instanceName}`))).toBe(true)
  })

  it('treats the Evolution 404 for a missing admin-scoped instance as absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ status: 404 }), { status: 404 })
    }))
    const client = createEvolutionClient({ ...base, adminApiKey: 'global-secret', channel: 'baileys' })
    expect(await client.getInstanceAsAdmin()).toBeNull()
    await expect(client.getInstance()).rejects.toMatchObject({ status: 404 })
    expect(calls.map(call => (call.init.headers as Record<string, string>).apikey))
      .toEqual(['global-secret', base.token])
  })

  it('rejects a create response for another instance', async () => {
    reply({ instance: { instanceName: 'foreign' }, hash: base.token })
    await expect(createEvolutionClient({ ...base, adminApiKey: 'global', channel: 'baileys' }).createInstance()).rejects.toThrow('Identidade Evolution divergente')
  })

  it('rejects ambiguous scoped instance lookup', async () => {
    reply([{ name: base.instanceName }, { name: 'foreign' }])
    await expect(createEvolutionClient({ ...base, channel: 'baileys' }).getInstance()).rejects.toThrow('Identidade Evolution divergente')
  })

  it('reports the remote channel instead of repeating the reserved channel', async () => {
    reply([{ name: base.instanceName, integration: 'WHATSAPP-BUSINESS', connectionStatus: 'open' }])
    expect(await createEvolutionClient({ ...base, channel: 'baileys' }).getInstance())
      .toMatchObject({ channel: 'cloud' })
    reply([{ name: base.instanceName, integration: 'UNKNOWN' }])
    await expect(createEvolutionClient({ ...base, channel: 'baileys' }).getInstance())
      .rejects.toThrow('Identidade Evolution divergente')
  })

  it('creates Cloud API using the Meta token and never connects by QR', async () => {
    reply({ instance: { instanceName: base.instanceName, instanceId: 'cloud-id', status: 'open' }, hash: base.token })
    const client = createEvolutionClient({ ...base, adminApiKey: 'global-secret', channel: 'cloud' })
    expect(await client.createInstance({ number: '12345678901', businessId: '12345678902' })).toMatchObject({ channel: 'cloud', state: 'connected' })
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ integration: 'WHATSAPP-BUSINESS', token: base.token, number: '12345678901', businessId: '12345678902', qrcode: false })
    await expect(client.connect()).rejects.toThrow('QR')
  })

  it('uses instance credentials for scoped state, QR, webhook, and one-number lookup', async () => {
    reply({ instance: { instanceName: base.instanceName, state: 'close' } })
    const client = createEvolutionClient({ ...base, channel: 'baileys' })
    expect(await client.getStatus()).toEqual({ state: 'disconnected' })
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(String(url).includes('connectionState')
        ? { instance: { state: 'close' } } : { code: 'qr-text', base64: 'data:image/png;base64,AAAA' }))
    }))
    expect(await client.connect()).toEqual({ state: 'connecting', qrCode: 'data:image/png;base64,AAAA' })
    reply({ enabled: true, url: 'https://zingara.example/hook', events: ['MESSAGES_UPDATE'], headers: { 'x-secret': 'hidden' } })
    expect(await client.configureWebhook({ url: 'https://zingara.example/hook', headerName: 'x-secret', secret: 'hidden', events: ['MESSAGES_UPDATE'] })).toEqual({ enabled: true, url: 'https://zingara.example/hook', events: ['MESSAGES_UPDATE'] })
    expect(await client.getWebhook()).toEqual({ enabled: true, url: 'https://zingara.example/hook', events: ['MESSAGES_UPDATE'] })
    reply([{ number: '5567999999999', exists: true, jid: '5567999999999@s.whatsapp.net' }])
    expect(await client.checkNumber('+5567999999999')).toEqual({ number: '5567999999999', exists: true })
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/instance/connectionState/zingara-test-123', '/instance/connectionState/zingara-test-123', '/instance/connect/zingara-test-123', '/webhook/set/zingara-test-123',
      '/webhook/find/zingara-test-123', '/chat/whatsappNumbers/zingara-test-123',
    ])
    expect(calls.every(call => (call.init.headers as Record<string, string>).apikey === base.token)).toBe(true)
    await expect(client.checkNumber('123')).rejects.toThrow()
  })

  it('reads the current QR from Evolution while pairing is already in progress', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify(String(url).includes('connectionState')
        ? { instance: { state: 'connecting' } }
        : { base64: 'data:image/png;base64,AAAA' }))
    }))
    const client = createEvolutionClient({ ...base, channel: 'baileys' })
    expect(await client.connect()).toEqual({ state: 'connecting', qrCode: 'data:image/png;base64,AAAA' })
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/instance/connectionState/zingara-test-123', '/instance/connect/zingara-test-123',
    ])
  })

  it('keeps the pairing state when Evolution has not generated a replacement QR yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      String(url).includes('connectionState') ? { instance: { state: 'connecting' } } : {},
    ))))
    expect(await createEvolutionClient({ ...base, channel: 'baileys' }).connect())
      .toEqual({ state: 'connecting' })
  })

  it('blocks unsupported channel operations and real sends without approval', async () => {
    const cloud = createEvolutionClient({ ...base, channel: 'cloud' })
    await expect(cloud.connect()).rejects.toThrow('QR')
    await expect(cloud.checkNumber('+5567999999999')).rejects.toThrow('Baileys')
    await expect(cloud.sendText({ number: '+5567999999999', text: 'Oi' })).rejects.toThrow('desabilitado')
    await expect(cloud.sendTemplate({ number: '+5567999999999', name: 'convite', language: 'pt_BR', components: [] })).rejects.toThrow('desabilitado')
    expect(calls).toHaveLength(0)
  })

  it('sends Baileys text/media and Cloud template with normalized IDs', async () => {
    reply({ key: { id: 'wamid-1', remoteJid: '5567999999999@s.whatsapp.net' }, status: 'PENDING' }, 201)
    vi.stubEnv('EVOLUTION_REAL_SEND_ENABLED', 'true')
    const allowed = { ...base, realSendEnabled: true, allowedDestinations: ['+5567999999999'] }
    const baileys = createEvolutionClient({ ...allowed, channel: 'baileys' })
    expect(await baileys.sendText({ number: '+5567999999999', text: 'Oi' })).toEqual({ messageId: 'wamid-1', status: 'pending' })
    expect(await baileys.sendMedia({ number: '+5567999999999', media: 'https://zingara.example/a.webp', mediatype: 'image', caption: 'Convite' })).toEqual({ messageId: 'wamid-1', status: 'pending' })
    const cloud = createEvolutionClient({ ...allowed, channel: 'cloud' })
    expect(await cloud.sendTemplate({ number: '+5567999999999', name: 'convite', language: 'pt_BR', components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }] })).toEqual({ messageId: 'wamid-1', status: 'pending' })
    expect(calls.map(call => new URL(call.url).pathname)).toEqual([
      '/message/sendText/zingara-test-123', '/message/sendMedia/zingara-test-123', '/message/sendTemplate/zingara-test-123',
    ])
    expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({ number: '5567999999999', name: 'convite', language: 'pt_BR' })
    await expect(baileys.sendTemplate({ number: '+5567999999999', name: 'convite', language: 'pt_BR', components: [] })).rejects.toThrow('Cloud')
  })

  it('accepts Compose flag 1 only for the recipient approved in this client', async () => {
    vi.stubEnv('EVOLUTION_REAL_SEND_ENABLED', '1')
    reply({ key: { id: 'wamid-approved' }, status: 'PENDING' }, 201)
    const approved = createEvolutionClient({ ...base, channel: 'baileys', realSendEnabled: true, allowedDestinations: ['+5567999999999'] })
    expect(await approved.sendText({ number: '+5567999999999', text: 'Convite aprovado' })).toEqual({ messageId: 'wamid-approved', status: 'pending' })
    await expect(approved.sendText({ number: '+5511999999999', text: 'Outro' })).rejects.toThrow('allowlist')
    const noApproval = createEvolutionClient({ ...base, channel: 'baileys', realSendEnabled: true })
    await expect(noApproval.sendText({ number: '+5567999999999', text: 'Sem aprovação' })).rejects.toThrow('allowlist')
    expect(calls).toHaveLength(1)
  })

  it('reads template approval, message status and scoped instance metadata', async () => {
    const client = createEvolutionClient({ ...base, channel: 'cloud' })
    reply({ data: [{ name: 'convite', language: 'pt_BR', status: 'APPROVED' }] })
    expect(await client.getTemplate('convite', 'pt_BR')).toEqual({ name: 'convite', language: 'pt_BR', status: 'approved' })
    reply([{ key: { id: 'wamid-1' }, status: 'DELIVERY_ACK' }])
    expect(await client.findMessage('wamid-1')).toEqual({ messageId: 'wamid-1', status: 'delivered' })
    reply([{ name: base.instanceName, id: 'id', integration: 'WHATSAPP-BUSINESS', connectionStatus: 'open' }])
    expect(await client.getInstance()).toEqual({ instanceName: base.instanceName, instanceId: 'id', channel: 'cloud', state: 'connected' })
    expect(calls[2]?.url).toBe('https://evolution.example/instance/fetchInstances?instanceName=zingara-test-123')
  })

  it('normalizes HTTP errors and treats send timeout as uncertain without retry', async () => {
    reply({ message: 'secret upstream detail' }, 429)
    const client = createEvolutionClient({ ...base, channel: 'baileys' })
    await expect(client.getStatus()).rejects.toMatchObject({ name: 'EvolutionHttpError', status: 429 })
    expect(calls).toHaveLength(1)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    vi.stubEnv('EVOLUTION_REAL_SEND_ENABLED', 'true')
    const send = createEvolutionClient({ ...base, channel: 'baileys', realSendEnabled: true, allowedDestinations: ['+5567999999999'] })
    await expect(send.sendText({ number: '+5567999999999', text: 'Oi' })).rejects.toBeInstanceOf(EvolutionUncertainError)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(EvolutionHttpError).toBeDefined()
  })

  it('validates webhook input, scopes destructive operations, and hides webhook headers', async () => {
    const client = createEvolutionClient({ ...base, channel: 'baileys' })
    await expect(client.configureWebhook({ url: 'http://localhost/hook', headerName: 'x-secret', secret: 'secret', events: ['MESSAGES_UPDATE'] })).rejects.toThrow()
    await expect(client.configureWebhook({ url: 'https://zingara.example/hook', headerName: 'x-secret', secret: 'secret', events: ['ALL'] })).rejects.toThrow()
    reply({ enabled: true, url: 'https://zingara.example/hook', events: ['MESSAGES_UPDATE'], headers: { 'x-secret': 'never-return' } })
    expect(await client.getWebhook()).toEqual({ enabled: true, url: 'https://zingara.example/hook', events: ['MESSAGES_UPDATE'] })
    await client.logout()
    await client.deleteInstance()
    expect(calls.map(call => [call.init.method, new URL(call.url).pathname])).toEqual([
      ['GET', '/webhook/find/zingara-test-123'], ['DELETE', '/instance/logout/zingara-test-123'], ['DELETE', '/instance/delete/zingara-test-123'],
    ])
    expect(calls.every(call => (call.init.headers as Record<string, string>).apikey === base.token)).toBe(true)
  })

  it('blocks Cloud free text without a confirmed service window and rejects invalid reply IDs', async () => {
    vi.stubEnv('EVOLUTION_REAL_SEND_ENABLED', 'true')
    const client = createEvolutionClient({ ...base, channel: 'cloud', realSendEnabled: true, allowedDestinations: ['+5567999999999'] })
    await expect(client.sendText({ number: '+5567999999999', text: 'Oi' })).rejects.toThrow('Janela')
    reply({ status: 'PENDING' }, 201)
    await expect(client.sendTemplate({ number: '+5567999999999', name: 'convite', language: 'pt_BR', components: [] })).rejects.toBeInstanceOf(EvolutionUncertainError)
    expect(calls).toHaveLength(1)
    reply({ error: 'upstream' }, 503)
    await expect(client.sendTemplate({ number: '+5567999999999', name: 'convite', language: 'pt_BR', components: [] })).rejects.toBeInstanceOf(EvolutionUncertainError)
  })

  it('keeps fake state and sends isolated by instance', async () => {
    const fake = createEvolutionClient({ ...base, mode: 'fake', channel: 'baileys' })
    expect(await fake.getStatus()).toEqual({ state: 'disconnected' })
    expect((await fake.connect()).state).toBe('connecting')
    expect((await createEvolutionClient({ ...base, mode: 'fake', channel: 'baileys' }).getStatus()).state).toBe('connecting')
    expect((await fake.sendText({ number: '+5567999999999', text: 'Oi' })).messageId).toMatch(/^fake-evolution-/)
    expect(calls).toHaveLength(0)
  })
})
