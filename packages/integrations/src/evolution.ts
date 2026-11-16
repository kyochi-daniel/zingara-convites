import { createHash } from 'node:crypto'

export type EvolutionChannel = 'baileys' | 'cloud'
export type EvolutionState = 'disconnected' | 'connecting' | 'connected' | 'unknown'
export type EvolutionConfig = {
  baseUrl: string
  instanceName: string
  token: string
  channel: EvolutionChannel
  adminApiKey?: string
  mode?: 'fake' | 'real'
  realSendEnabled?: boolean
  allowedDestinations?: readonly string[]
}
export type EvolutionStatus = { state: EvolutionState; qrCode?: string }
export type EvolutionInstance = EvolutionStatus & { instanceName: string; instanceId?: string; channel: EvolutionChannel }
export type EvolutionInventoryItem = { instanceName: string; channel: EvolutionChannel | 'unknown'; state: EvolutionState; maskedNumber?: string }
export type EvolutionInstallationConfig = { baseUrl: string; adminApiKey: string; mode?: 'fake' | 'real' }
export type EvolutionSendResult = { messageId: string; status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown' }
export type EvolutionWebhook = { enabled: boolean; url: string; events: string[] }
export type EvolutionWebhookInput = { url: string; headerName: string; secret: string; events: readonly string[] }
export type EvolutionTemplate = { name: string; language: string; status: 'approved' | 'rejected' | 'pending' | 'unknown' }
export type EvolutionTemplateInput = { number: string; name: string; language: string; components: readonly unknown[] }
export type EvolutionClient = {
  createInstance(input?: { businessId: string; number: string }): Promise<EvolutionInstance>
  getInstance(): Promise<EvolutionInstance | null>
  getInstanceAsAdmin(): Promise<EvolutionInstance | null>
  getStatus(): Promise<EvolutionStatus>
  connect(): Promise<EvolutionStatus>
  logout(): Promise<void>
  deleteInstance(): Promise<void>
  configureWebhook(input: EvolutionWebhookInput): Promise<EvolutionWebhook>
  getWebhook(): Promise<EvolutionWebhook | null>
  checkNumber(number: string): Promise<{ number: string; exists: boolean }>
  getTemplate(name: string, language: string): Promise<EvolutionTemplate | null>
  sendText(input: { number: string; text: string; serviceWindowOpen?: boolean }): Promise<EvolutionSendResult>
  sendMedia(input: { number: string; media: string; mediatype: 'image' | 'document' | 'video' | 'audio'; caption?: string; mimetype?: string; fileName?: string }): Promise<EvolutionSendResult>
  sendTemplate(input: EvolutionTemplateInput): Promise<EvolutionSendResult>
  findMessage(messageId: string): Promise<EvolutionSendResult | null>
}

export class EvolutionHttpError extends Error {
  readonly status: number
  readonly retryAfterMs?: number
  constructor(status: number, retryAfterMs?: number) {
    super(`Evolution HTTP ${status}`)
    this.name = 'EvolutionHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}
export class EvolutionUncertainError extends Error {
  constructor() { super('Resultado de envio Evolution incerto'); this.name = 'EvolutionUncertainError' }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function string(value: unknown, max = 2048): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}
function state(value: unknown): EvolutionState {
  const raw = String(value || '').toLowerCase()
  return raw === 'open' || raw === 'connected' ? 'connected' : raw === 'close' || raw === 'disconnected' ? 'disconnected'
    : raw === 'connecting' || raw === 'qr' ? 'connecting' : 'unknown'
}
function status(value: unknown): EvolutionStatus {
  const body = object(value)
  const instance = object(body.instance)
  const qrcode = object(body.qrcode)
  const qrCode = string(body.base64, 100_000) || string(qrcode.base64, 100_000)
  return { state: qrCode ? 'connecting' : state(instance.state || instance.status || instance.connectionStatus || body.state || body.connectionStatus), ...(qrCode ? { qrCode } : {}) }
}
function deliveryStatus(value: unknown): EvolutionSendResult['status'] {
  const raw = String(value || '').toUpperCase()
  return raw === 'PENDING' ? 'pending' : raw === 'SERVER_ACK' || raw === 'SENT' ? 'sent'
    : raw === 'DELIVERY_ACK' || raw === 'DELIVERED' ? 'delivered'
      : raw === 'READ' || raw === 'READ_ACK' ? 'read' : raw === 'ERROR' || raw === 'FAILED' ? 'failed' : 'unknown'
}
function sendResult(value: unknown): EvolutionSendResult {
  const body = object(value)
  const messageId = string(object(body.key).id) || string(body.id)
  if (!messageId) throw new EvolutionUncertainError()
  return { messageId, status: deliveryStatus(body.status) }
}
function number(value: string): string {
  const digits = value.replace(/^\+/, '')
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Destinatário inválido')
  return digits
}
function webhook(value: unknown): EvolutionWebhook | null {
  const raw = object(value)
  const entry = object(raw.webhook || value)
  const url = string(entry.url)
  if (!url) return null
  return { enabled: entry.enabled === true, url, events: Array.isArray(entry.events) ? entry.events.filter(item => typeof item === 'string' && item.length <= 100) : [] }
}
const fake = new Map<string, { state: EvolutionState; count: number; webhook?: EvolutionWebhook; exists: boolean; origin: string; name: string; channel: EvolutionChannel }>()

function evolutionOrigin(baseUrl: string): URL {
  let url: URL
  try { url = new URL(baseUrl) } catch { throw new Error('URL Evolution inválida') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || baseUrl.includes('\\')) throw new Error('URL Evolution inválida')
  return url
}

export function validateEvolutionInstallationOrigin(baseUrl: string, allowedOrigin: string): string {
  const requested = evolutionOrigin(baseUrl).origin
  if (!allowedOrigin || evolutionOrigin(allowedOrigin).origin !== requested) throw new Error('Origem Evolution não autorizada')
  return requested
}

function evolutionKey(value: string, global = false): string {
  if (!value || value.length > 4096 || /[\r\n]/.test(value)) throw new Error(global ? 'API key Evolution inválida' : 'Token Evolution inválido')
  return value
}

async function evolutionCall(url: URL, key: string, method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown, sending = false): Promise<unknown> {
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  if (body && Buffer.byteLength(body) > 10 * 1024 * 1024) throw new Error('Requisição Evolution excede limite')
  let response: Response
  try {
    const options: RequestInit = { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) } }
    if (body) options.body = body
    response = await fetch(new URL(path, url), options)
  } catch { throw sending ? new EvolutionUncertainError() : new Error('Falha de transporte Evolution') }
  const retryHeader = response.headers.get('retry-after')
  const retrySeconds = retryHeader ? Number(retryHeader) : NaN
  if (!response.ok) {
    if (sending && response.status >= 500) throw new EvolutionUncertainError()
    throw new EvolutionHttpError(response.status, Number.isFinite(retrySeconds) && retrySeconds >= 0 ? Math.min(retrySeconds * 1000, 86_400_000) : undefined)
  }
  const maxResponseBytes = 1024 * 1024
  if (Number(response.headers.get('content-length') || 0) > maxResponseBytes) {
    await response.body?.cancel().catch(() => {})
    throw sending ? new EvolutionUncertainError() : new Error('Resposta Evolution excede limite')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let overLimit = false
  try {
    const reader = response.body?.getReader()
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxResponseBytes) {
          overLimit = true
          await reader.cancel().catch(() => {})
          break
        }
        chunks.push(value)
      }
    }
  } catch { throw sending ? new EvolutionUncertainError() : new Error('Falha de transporte Evolution') }
  if (overLimit) throw sending ? new EvolutionUncertainError() : new Error('Resposta Evolution excede limite')
  const data = Buffer.concat(chunks, size).toString('utf8')
  try { return data ? JSON.parse(data) : null } catch { throw sending ? new EvolutionUncertainError() : new Error('Resposta Evolution inválida') }
}

function inventory(value: unknown): EvolutionInventoryItem[] {
  if (!Array.isArray(value)) throw new Error('Inventário Evolution inválido')
  const names = new Set<string>()
  return value.map(raw => {
    const item = object(raw)
    const name = item.name ?? item.instanceName
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) || names.has(name)) throw new Error('Inventário Evolution inválido')
    names.add(name)
    const channel = item.integration === 'WHATSAPP-BAILEYS' ? 'baileys' : item.integration === 'WHATSAPP-BUSINESS' ? 'cloud' : 'unknown'
    const rawNumber = typeof item.number === 'string' ? item.number : typeof item.ownerJid === 'string' ? item.ownerJid.split('@')[0] : ''
    const digits = rawNumber.replace(/^\+/, '')
    return { instanceName: name, channel, state: state(item.connectionStatus || item.status),
      ...(/^[1-9]\d{7,14}$/.test(digits) ? { maskedNumber: `••••${digits.slice(-4)}` } : {}) }
  })
}

export function createEvolutionInstallationClient(config: EvolutionInstallationConfig) {
  const url = evolutionOrigin(config.baseUrl)
  const key = evolutionKey(config.adminApiKey, true)
  const mode = config.mode || (process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake')
  return { async verify(): Promise<void> {
    if (mode === 'real') await evolutionCall(url, key, 'POST', '/verify-creds')
  }, async listInstances(): Promise<EvolutionInventoryItem[]> {
    if (mode === 'fake') return [...fake.values()].filter(entry => entry.origin === url.origin && entry.exists)
      .map(entry => ({ instanceName: entry.name, channel: entry.channel, state: entry.state }))
    return inventory(await evolutionCall(url, key, 'GET', '/instance/fetchInstances'))
  } }
}

export async function proveEvolutionInstance(config: { baseUrl: string; instanceName: string; token: string; mode?: 'fake' | 'real' }): Promise<EvolutionInventoryItem> {
  const url = evolutionOrigin(config.baseUrl)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(config.instanceName)) throw new Error('Nome de instância Evolution inválido')
  const token = evolutionKey(config.token)
  const mode = config.mode || (process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake')
  const found = mode === 'fake' ? (() => {
    const key = createHash('sha256').update(url.origin).update('\0').update(config.instanceName).update('\0').update(token).digest('hex')
    const entry = fake.get(key)
    return entry?.exists ? [{ instanceName: entry.name, channel: entry.channel, state: entry.state }] : []
  })() : inventory(await evolutionCall(url, token, 'GET', '/instance/fetchInstances'))
  if (found.length !== 1 || found[0]?.instanceName !== config.instanceName) throw new Error('Identidade Evolution divergente')
  return found[0]
}

export function createEvolutionClient(config: EvolutionConfig): EvolutionClient {
  const url = evolutionOrigin(config.baseUrl)
  if (!/^zingara-[a-z0-9-]{6,80}$/.test(config.instanceName)) throw new Error('Nome de instância Evolution inválido')
  evolutionKey(config.token)
  if (config.adminApiKey) evolutionKey(config.adminApiKey, true)
  const mode = config.mode || (process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake')
  const pathName = encodeURIComponent(config.instanceName)
  const fakeKey = createHash('sha256').update(url.origin).update('\0').update(config.instanceName).update('\0').update(config.token).digest('hex')
  const fakeEntry = () => {
    let entry = fake.get(fakeKey)
    if (!entry) { entry = { state: 'disconnected', count: 0, exists: false, origin: url.origin, name: config.instanceName, channel: config.channel }; fake.set(fakeKey, entry) }
    return entry
  }
  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown, admin = false, sending = false): Promise<unknown> {
    const key = admin ? config.adminApiKey : config.token
    if (!key) throw new Error('API key global Evolution ausente')
    return evolutionCall(url, key, method, path, payload, sending)
  }
  function recipient(value: string): string {
    const digits = number(value)
    if (mode === 'real' && (config.realSendEnabled !== true || !['1', 'true'].includes(process.env.EVOLUTION_REAL_SEND_ENABLED || ''))) throw new Error('Envio real Evolution desabilitado')
    if (mode === 'real' && !config.allowedDestinations?.some(item => item.replace(/^\+/, '') === digits)) throw new Error('Destinatário fora da allowlist')
    return digits
  }
  function fakeSend(): EvolutionSendResult {
    const entry = fakeEntry()
    entry.count += 1
    return { messageId: `fake-evolution-${entry.count}`, status: 'pending' }
  }
  async function lookupInstance(admin = false): Promise<EvolutionInstance | null> {
    if (mode === 'fake') {
      const entry = admin
        ? [...fake.values()].find(item => item.origin === url.origin && item.name === config.instanceName && item.exists)
        : fakeEntry()
      return entry?.exists ? { instanceName: config.instanceName, channel: config.channel, state: entry.state } : null
    }
    let response: unknown
    try { response = await call('GET', `/instance/fetchInstances?instanceName=${pathName}`, undefined, admin) }
    catch (error) {
      // Evolution 2.3.7 returns 404 for a name that has not been created yet.
      if (admin && error instanceof EvolutionHttpError && error.status === 404) return null
      throw error
    }
    if (!Array.isArray(response)) throw new Error('Resposta Evolution inválida')
    if (response.length === 0) return null
    if (response.length !== 1 || (object(response[0]).name ?? object(response[0]).instanceName) !== config.instanceName) throw new Error('Identidade Evolution divergente')
    const item = object(response[0])
    const channel = item.integration === 'WHATSAPP-BAILEYS' ? 'baileys' : item.integration === 'WHATSAPP-BUSINESS' ? 'cloud' : null
    if (!channel) throw new Error('Identidade Evolution divergente')
    return { instanceName: config.instanceName, instanceId: string(item.id) || string(item.instanceId), channel, state: state(item.connectionStatus || item.status) }
  }
  return {
    async createInstance(input) {
      if (config.channel === 'cloud' && (!input || !/^\d{5,30}$/.test(input.number) || !/^\d{5,30}$/.test(input.businessId))) throw new Error('Dados Cloud API inválidos')
      if (config.channel === 'baileys' && input) throw new Error('Dados Cloud API em instância Baileys')
      if (mode === 'fake') { fakeEntry().exists = true; return { instanceName: config.instanceName, channel: config.channel, state: 'disconnected' } }
      const result = object(await call('POST', '/instance/create', { instanceName: config.instanceName, integration: config.channel === 'cloud' ? 'WHATSAPP-BUSINESS' : 'WHATSAPP-BAILEYS', token: config.token, qrcode: false, ...input }, true))
      const instance = object(result.instance)
      if (instance.instanceName !== config.instanceName || result.hash !== config.token) throw new Error('Identidade Evolution divergente')
      return { instanceName: config.instanceName, instanceId: string(instance.instanceId), channel: config.channel, state: state(instance.status) }
    },
    async getInstance() { return lookupInstance() },
    async getInstanceAsAdmin() { return lookupInstance(true) },
    async getStatus() { return mode === 'fake' ? { state: fakeEntry().state } : status(await call('GET', `/instance/connectionState/${pathName}`)) },
    async connect() {
      if (config.channel !== 'baileys') throw new Error('QR disponível somente para Baileys')
      const current = await this.getStatus()
      if (current.state === 'connected') return current
      if (mode === 'fake') { fakeEntry().state = 'connecting'; return { state: 'connecting', qrCode: 'fake-qr' } }
      const connected = status(await call('GET', `/instance/connect/${pathName}`))
      return connected.state === 'unknown' && current.state === 'connecting' ? current : connected
    },
    async logout() { if (mode === 'fake') { fakeEntry().state = 'disconnected'; return }; await call('DELETE', `/instance/logout/${pathName}`) },
    async deleteInstance() { if (mode === 'fake') { fake.delete(fakeKey); return }; await call('DELETE', `/instance/delete/${pathName}`) },
    async configureWebhook(input) {
      const target = new URL(input.url)
      if (target.protocol !== 'https:' || target.username || target.password || target.hash || !/^x-[a-z0-9-]{1,60}$/.test(input.headerName) || !input.secret || /[\r\n]/.test(input.secret) || input.secret.length > 4096) throw new Error('Webhook Evolution inválido')
      if (!input.events.length || input.events.some(item => !['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE'].includes(item))) throw new Error('Eventos Evolution inválidos')
      const setup = { webhook: { enabled: true, url: input.url, events: [...input.events], headers: { [input.headerName]: input.secret }, byEvents: false, base64: false } }
      if (mode === 'fake') { fakeEntry().webhook = { enabled: true, url: input.url, events: [...input.events] }; return fakeEntry().webhook! }
      const configured = webhook(await call('POST', `/webhook/set/${pathName}`, setup))
      if (!configured || configured.url !== input.url) throw new Error('Webhook Evolution não confirmado')
      return configured
    },
    async getWebhook() { return mode === 'fake' ? fakeEntry().webhook || null : webhook(await call('GET', `/webhook/find/${pathName}`)) },
    async checkNumber(value) {
      if (config.channel !== 'baileys') throw new Error('Consulta de número disponível somente para Baileys')
      const digits = number(value)
      if (mode === 'fake') return { number: digits, exists: true }
      const result = await call('POST', `/chat/whatsappNumbers/${pathName}`, { numbers: [digits] })
      const item = Array.isArray(result) && result.length === 1 ? object(result[0]) : {}
      if (item.number !== digits || typeof item.exists !== 'boolean') throw new Error('Resposta Evolution de número inválida')
      return { number: digits, exists: item.exists }
    },
    async getTemplate(name, language) {
      if (config.channel !== 'cloud') throw new Error('Templates disponíveis somente para Cloud API')
      if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[a-z]{2,3}_[A-Z]{2}$/.test(language)) throw new Error('Template inválido')
      if (mode === 'fake') return { name, language, status: 'approved' }
      const result = await call('GET', `/template/find/${pathName}`)
      const body = object(result)
      const templates = Array.isArray(body.data) ? body.data : Array.isArray(result) ? result : []
      const found = templates.find(item => object(item).name === name && object(item).language === language)
      if (!found) return null
      const raw = String(object(found).status || '').toUpperCase()
      return { name, language, status: raw === 'APPROVED' ? 'approved' : raw === 'REJECTED' ? 'rejected' : raw === 'PENDING' ? 'pending' : 'unknown' }
    },
    async sendText(input) {
      const digits = recipient(input.number)
      if (config.channel === 'cloud' && input.serviceWindowOpen !== true) throw new Error('Janela de atendimento Cloud API não confirmada')
      if (!input.text || input.text.length > 65_536) throw new Error('Texto inválido')
      return mode === 'fake' ? fakeSend() : sendResult(await call('POST', `/message/sendText/${pathName}`, { number: digits, text: input.text }, false, true))
    },
    async sendMedia(input) {
      const digits = recipient(input.number)
      if (config.channel !== 'baileys') throw new Error('Mídia livre disponível somente para Baileys')
      if ((mode === 'real' && !input.media.startsWith('https://')) || input.media.length > 8192 ||
        (input.caption && input.caption.length > 65_536)) throw new Error('Mídia inválida')
      return mode === 'fake' ? fakeSend() : sendResult(await call('POST', `/message/sendMedia/${pathName}`, { ...input, number: digits }, false, true))
    },
    async sendTemplate(input) {
      const digits = recipient(input.number)
      if (config.channel !== 'cloud') throw new Error('Template disponível somente para Cloud API')
      if (!/^[a-z0-9_]{1,512}$/.test(input.name) || !/^[a-z]{2,3}_[A-Z]{2}$/.test(input.language) || !Array.isArray(input.components)) throw new Error('Template inválido')
      return mode === 'fake' ? fakeSend() : sendResult(await call('POST', `/message/sendTemplate/${pathName}`, { ...input, number: digits }, false, true))
    },
    async findMessage(messageId) {
      if (!/^[A-Za-z0-9._-]{1,256}$/.test(messageId)) throw new Error('ID de mensagem inválido')
      if (mode === 'fake') return null
      const result = await call('POST', `/chat/findMessages/${pathName}`, { where: { key: { id: messageId } }, take: 1 })
      const found = Array.isArray(result) ? result.find(item => object(object(item).key).id === messageId) : undefined
      return found ? sendResult(found) : null
    },
  }
}
