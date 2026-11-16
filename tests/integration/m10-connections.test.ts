import { createHash, randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createEvolutionClient } from '../../packages/integrations/src/evolution'
import { connectDatabase, DeliveryModel, EvolutionConnectionModel, OrganizationModel, UazapiConnectionModel } from '../../packages/database/src/index'
import { activeConnectionIdentity, allowEvolutionWebhookAttempt, approvedEvolutionTemplate, createEvolutionConnection, evolutionCredentials, ingestEvolutionWebhook, listDispatchableDeliveryIds, processDelivery, processWebhookInbox, provisionEvolutionConnection, readActiveConnection, retireEvolutionConnection, saveEvolutionTemplate, selectActiveConnection } from '../../packages/core/src/index'
import { WebhookInboxModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m10-evolution`).digest('base64')
process.env.EVOLUTION_MODE = 'fake'
process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test'
let organizationId: string
let otherOrganizationId: string

beforeAll(async () => {
  await connectDatabase()
  organizationId = String((await OrganizationModel.create({ name: 'M10' }))._id)
  otherOrganizationId = String((await OrganizationModel.create({ name: 'M10 outra' }))._id)
})

afterAll(async () => {
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
})

test('documento Uazapi legado permanece para histórico, mas não vira conexão ativa', async () => {
  const bound = await UazapiConnectionModel.create({ organizationId, serverUrl: 'https://1.1.1.1',
    tokenCiphertext: 'historical-ciphertext', tokenHash: 'historical-hash' })
  expect(await readActiveConnection(organizationId)).toBeNull()
  expect(await selectActiveConnection(organizationId, bound.id, 'uazapigo', 0)).toEqual({ error: 'NOT_FOUND' })
  const stored = await UazapiConnectionModel.findOne({ organizationId })
  expect(stored?.tokenCiphertext).toBeUndefined()
})

test('job Uazapi legado é suprimido antes de qualquer chamada de envio', async () => {
  const db = await connectDatabase()
  const connection = await UazapiConnectionModel.findOne({ organizationId })
  const doc = await DeliveryModel.create({ organizationId, eventId: new db.Types.ObjectId(),
    invitationId: new db.Types.ObjectId(), guestId: new db.Types.ObjectId(), type: 'initial',
    templateVersion: 1, contentHash: 'old', approvedMode: 'fake', approvedConnectionId: connection?._id,
    approvedConnectionServerUrl: 'https://1.1.1.1', approvedConnectionTokenHash: 'old',
    recipientPhone: '+5567999999999', status: 'queued', media: { status: 'pending' }, text: { status: 'pending' },
    approvedAt: new Date() })
  await processDelivery(doc.id, { renderMedia: async () => { throw new Error('não chamar') } })
  expect(await DeliveryModel.findById(doc.id)).toMatchObject({ status: 'suppressed', suppressionReason: 'legacy_provider' })
})

test('reserva Evolution idempotente e seleciona apenas conexão própria pronta', async () => {
  const first = await createEvolutionConnection(organizationId, { channel: 'baileys' })
  expect(first && 'connection' in first).toBe(true)
  if (!first || !('connection' in first)) return
  const again = await createEvolutionConnection(organizationId, { channel: 'baileys' })
  expect(again).toMatchObject({ connection: { id: first.connection.id, instanceName: first.connection.instanceName } })
  expect(await EvolutionConnectionModel.countDocuments({ organizationId, channel: 'baileys' })).toBe(1)
  const stored = await EvolutionConnectionModel.findById(first.connection.id)
  expect(stored?.instanceTokenCiphertext).toBeUndefined()
  expect(stored?.webhookSecretCiphertext).toBeUndefined()
  expect(await selectActiveConnection(otherOrganizationId, first.connection.id)).toEqual({ error: 'NOT_FOUND' })
  expect(await selectActiveConnection(organizationId, first.connection.id)).toEqual({ error: 'NOT_FOUND' })
  await EvolutionConnectionModel.updateOne({ _id: first.connection.id }, { $set: { state: 'creating' } })
  expect(await selectActiveConnection(organizationId, first.connection.id)).toEqual({ error: 'NOT_FOUND' })
  await EvolutionConnectionModel.updateOne({ _id: first.connection.id }, { $set: { state: 'error' } })
  expect(await selectActiveConnection(organizationId, first.connection.id)).toEqual({ error: 'NOT_FOUND' })
  await EvolutionConnectionModel.updateOne({ _id: first.connection.id }, { $set: { state: 'reserved' } })
  expect(await provisionEvolutionConnection(organizationId, first.connection.id)).toMatchObject({
    connection: { id: first.connection.id, state: 'ready' },
  })
  expect(await selectActiveConnection(organizationId, first.connection.id)).toMatchObject({
    connection: { provider: 'evolution', channel: 'baileys', connectionId: first.connection.id, revision: 1 },
  })
  expect(await readActiveConnection(organizationId)).toMatchObject({ provider: 'evolution', channel: 'baileys', revision: 1 })
  expect(await selectActiveConnection(organizationId, first.connection.id, 'evolution', 0)).toEqual({ error: 'CONFLICT' })
  expect(await provisionEvolutionConnection(organizationId, first.connection.id)).toMatchObject({
    connection: { id: first.connection.id, state: 'ready' },
  })
})

test('troca de conexão não suprime entrega criada na nova revisão durante o corte', async () => {
  const tenant = String((await OrganizationModel.create({ name: 'Troca concorrente' }))._id)
  const baileys = await createEvolutionConnection(tenant, { channel: 'baileys' })
  const cloud = await createEvolutionConnection(tenant, { channel: 'cloud', metaToken: 'meta-token-race-test-123456',
    phoneNumberId: '123456789013', businessId: '234567890124' })
  if (!('connection' in baileys) || !('connection' in cloud)) throw new Error('Reserva falhou')
  await provisionEvolutionConnection(tenant, baileys.connection.id)
  await provisionEvolutionConnection(tenant, cloud.connection.id)
  await selectActiveConnection(tenant, baileys.connection.id)
  const db = await connectDatabase()
  const delivery = (connectionId: string, revision: number) => ({ organizationId: tenant,
    eventId: new db.Types.ObjectId(), invitationId: new db.Types.ObjectId(), guestId: new db.Types.ObjectId(),
    type: 'initial', templateVersion: 1, contentHash: randomUUID(), approvedMode: 'fake',
    approvedConnectionId: connectionId, approvedConnectionServerUrl: process.env.EVOLUTION_BASE_URL,
    approvedConnectionTokenHash: randomUUID(), approvedProvider: 'evolution', approvedChannel: 'baileys',
    approvedConnectionRevision: revision, recipientPhone: '+5567999999999', status: 'queued',
    media: { status: 'pending' }, text: { status: 'pending' }, approvedAt: new Date() })
  const old = await DeliveryModel.create(delivery(baileys.connection.id, 1))
  const updateMany = DeliveryModel.updateMany.bind(DeliveryModel)
  let concurrentId = ''
  const spy = vi.spyOn(DeliveryModel, 'updateMany')
  ;(spy as any).mockImplementationOnce(async (filter: unknown, update: unknown, options?: unknown) => {
    const concurrent = await DeliveryModel.create({ ...delivery(cloud.connection.id, 2), approvedChannel: 'cloud' })
    concurrentId = concurrent.id
    return updateMany(filter as any, update as any, options as any)
  })
  try {
    expect(await selectActiveConnection(tenant, cloud.connection.id)).toMatchObject({ connection: { revision: 2 } })
  } finally {
    spy.mockRestore()
  }
  expect(await DeliveryModel.findById(old.id)).toMatchObject({ status: 'suppressed', suppressionReason: 'connection_changed' })
  expect(await DeliveryModel.findById(concurrentId)).toMatchObject({ status: 'queued' })
})

test('corte suprime backlog Uazapi antes de listar trabalho Evolution', async () => {
  const db = await connectDatabase()
  const legacyIds: string[] = []
  for (let index = 0; index < 3; index++) {
    const legacy = await DeliveryModel.create({ organizationId, eventId: new db.Types.ObjectId(),
      invitationId: new db.Types.ObjectId(), guestId: new db.Types.ObjectId(), type: 'initial',
      templateVersion: 1, contentHash: `legacy-${index}`, approvedMode: 'fake',
      approvedConnectionId: new db.Types.ObjectId(), approvedConnectionServerUrl: 'https://legacy.invalid',
      approvedConnectionTokenHash: 'legacy', recipientPhone: '+5567999999999', status: 'queued',
      media: { status: 'pending' }, text: { status: 'pending' }, approvedAt: new Date(Date.now() - 60_000) })
    legacyIds.push(legacy.id)
  }
  const identity = await activeConnectionIdentity(organizationId)
  if (!identity) throw new Error('Conexão ativa ausente')
  const evolution = await DeliveryModel.create({ organizationId, eventId: new db.Types.ObjectId(),
    invitationId: new db.Types.ObjectId(), guestId: new db.Types.ObjectId(), type: 'initial',
    templateVersion: 1, contentHash: 'evolution-current', ...identity, recipientPhone: '+5567999999999',
    status: 'queued', media: { status: 'pending' }, text: { status: 'pending' }, approvedAt: new Date() })
  const [dispatchable] = await listDispatchableDeliveryIds(1)
  expect(dispatchable).toBeTruthy()
  expect((await DeliveryModel.findById(dispatchable))?.approvedProvider).toBe('evolution')
  expect((await DeliveryModel.findById(evolution.id))?.status).toBe('queued')
  expect(await DeliveryModel.countDocuments({ _id: { $in: legacyIds }, status: 'suppressed',
    suppressionReason: 'legacy_provider' })).toBe(3)
})

test('erro de status aplica pausa exponencial atômica e encerra após o limite', async () => {
  const identity = await activeConnectionIdentity(organizationId)
  if (!identity) throw new Error('Conexão ativa ausente')
  const db = await connectDatabase()
  const createDelivery = () => DeliveryModel.create({ organizationId, eventId: new db.Types.ObjectId(),
    invitationId: new db.Types.ObjectId(), guestId: new db.Types.ObjectId(), type: 'automation',
    automationRuleId: new db.Types.ObjectId(), automationRevision: 1, automationOccurrence: randomUUID(),
    automationText: 'Lembrete', scheduledAt: new Date(Date.now() - 1_000), templateVersion: 1,
    contentHash: randomUUID(), ...identity, recipientPhone: '+5567999999999', status: 'queued',
    media: { status: 'skipped' }, text: { status: 'pending' }, approvedAt: new Date() })
  const first = await createDelivery()
  const second = await createDelivery()
  let statusCalls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const client = createEvolutionClient({ baseUrl: process.env.EVOLUTION_BASE_URL!, instanceName: 'zingara-status-error',
    token: 'status-error-token', channel: 'baileys', mode: 'fake' })
  client.getStatus = async () => {
    statusCalls++
    if (statusCalls === 2) release()
    await gate
    throw new Error('timeout')
  }
  const deps = { renderMedia: async () => { throw new Error('não chamar') },
    evaluateAutomation: async () => ({ eligible: true as const, text: 'Lembrete', recipientPhone: '+5567999999999' }),
    createEvolutionClient: () => client }
  await Promise.all([processDelivery(first.id, deps), processDelivery(second.id, deps)])
  const connection = await EvolutionConnectionModel.findById(identity.approvedConnectionId)
  expect(connection?.unavailableAttempts).toBe(2)
  expect(connection?.unavailableUntil?.getTime()).toBeGreaterThan(Date.now() + 50_000)
  expect(await DeliveryModel.countDocuments({ _id: { $in: [first.id, second.id] }, status: 'retry_wait' })).toBe(2)

  await EvolutionConnectionModel.updateOne({ _id: identity.approvedConnectionId },
    { $set: { unavailableAttempts: 6 }, $unset: { unavailableUntil: '' } })
  const exhausted = await createDelivery()
  const failingClient = createEvolutionClient({ baseUrl: process.env.EVOLUTION_BASE_URL!, instanceName: 'zingara-status-error',
    token: 'status-error-token', channel: 'baileys', mode: 'fake' })
  failingClient.getStatus = async () => { throw new Error('dns') }
  await processDelivery(exhausted.id, { ...deps, createEvolutionClient: () => failingClient })
  expect(await DeliveryModel.findById(exhausted.id)).toMatchObject({ status: 'failed_permanent',
    text: { status: 'failed_permanent' } })
  expect((await EvolutionConnectionModel.findById(identity.approvedConnectionId))?.unavailableAttempts).toBe(7)
})

test('canal oficial usa token Meta cifrado como credencial reservada', async () => {
  const first = await createEvolutionConnection(otherOrganizationId, { channel: 'cloud',
    metaToken: 'meta-token-private-test-123456', phoneNumberId: '123456789012', businessId: '234567890123' })
  expect(first && 'connection' in first).toBe(true)
  if (!first || !('connection' in first)) return
  expect(await provisionEvolutionConnection(otherOrganizationId, first.connection.id)).toMatchObject({
    connection: { channel: 'cloud', state: 'ready' },
  })
  expect(await createEvolutionConnection(otherOrganizationId, { channel: 'cloud',
    metaToken: 'different-meta-token-123456', phoneNumberId: '123456789012', businessId: '234567890123' }))
    .toEqual({ error: 'CONFLICT' })
  expect(JSON.stringify(await EvolutionConnectionModel.findById(first.connection.id))).not.toContain('meta-token-private-test')
  expect(await approvedEvolutionTemplate(otherOrganizationId, first.connection.id, 'initial')).toBeNull()
  expect(await saveEvolutionTemplate(otherOrganizationId, first.connection.id,
    { type: 'initial', name: 'convite_01', language: 'pt_BR' })).toMatchObject({
    template: { type: 'initial', name: 'convite_01', status: 'approved' },
  })
  expect(await approvedEvolutionTemplate(otherOrganizationId, first.connection.id, 'initial'))
    .toMatchObject({ name: 'convite_01', variables: ['convite.link'] })
})

test('quota conta eventos únicos e retenção só começa após processamento', async () => {
  process.env.WEBHOOK_CONNECTION_LIMIT = '2'
  process.env.WEBHOOK_GLOBAL_LIMIT = '3'
  const connection = await EvolutionConnectionModel.findOne({ organizationId, channel: 'baileys' })
  const credentials = await evolutionCredentials(organizationId, String(connection?._id))
  const event = (id: string) => ({ event: 'messages.update', instance: connection?.instanceName,
    data: { keyId: id, status: 'READ' } })
  const ingest = (id: string) => ingestEvolutionWebhook(String(connection?._id), credentials!.webhookSecret, event(id))
  expect(await ingest('m10-one')).toMatchObject({ accepted: true, duplicate: false })
  expect(await ingest('m10-one')).toMatchObject({ accepted: true, duplicate: true })
  expect(await ingest('m10-two')).toMatchObject({ accepted: true, duplicate: false })
  expect(await ingest('m10-three')).toEqual({ error: 'RATE_LIMIT' })
  const pending = await WebhookInboxModel.findOne({ messageIds: 'm10-one' })
  expect(pending?.expiresAt).toBeUndefined()
  await processWebhookInbox(String(pending?._id))
  expect((await WebhookInboxModel.findById(pending?._id))?.expiresAt).toBeInstanceOf(Date)
  delete process.env.WEBHOOK_CONNECTION_LIMIT
  delete process.env.WEBHOOK_GLOBAL_LIMIT
})

test('webhook Evolution autentica instância exata e recibo não cruza organização', async () => {
  const db = await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ organizationId, channel: 'baileys' })
  const credentials = await evolutionCredentials(organizationId, String(connection?._id))
  expect(credentials?.webhookSecret).toBeTruthy()
  const eventId = new db.Types.ObjectId()
  const guestId = new db.Types.ObjectId()
  const invitationId = new db.Types.ObjectId()
  const own = await DeliveryModel.create({ organizationId, eventId, guestId, invitationId,
    type: 'initial', templateVersion: 1, contentHash: 'test', recipientPhone: '+5567999999999',
    approvedMode: 'fake', approvedConnectionId: connection?._id,
    approvedConnectionServerUrl: process.env.EVOLUTION_BASE_URL,
    approvedConnectionTokenHash: 'test', approvedProvider: 'evolution', approvedChannel: 'baileys',
    status: 'completed', media: { status: 'accepted', messageId: 'EV-1' }, text: { status: 'accepted' }, approvedAt: new Date() })
  const other = await DeliveryModel.create({ organizationId: otherOrganizationId, eventId: new db.Types.ObjectId(),
    guestId: new db.Types.ObjectId(), invitationId: new db.Types.ObjectId(), type: 'initial',
    templateVersion: 1, contentHash: 'test', recipientPhone: '+5567999999999', approvedMode: 'fake',
    approvedConnectionId: connection?._id, approvedConnectionServerUrl: process.env.EVOLUTION_BASE_URL,
    approvedConnectionTokenHash: 'test', status: 'completed', media: { status: 'accepted', messageId: 'EV-1' },
    text: { status: 'accepted' }, approvedAt: new Date() })
  const body = { event: 'messages.update', instance: connection?.instanceName,
    data: { keyId: 'EV-1', status: 'READ' }, apikey: 'must-not-persist' }
  expect(await ingestEvolutionWebhook(String(connection?._id), 'wrong-secret', body)).toEqual({ error: 'UNAUTHORIZED' })
  expect(await ingestEvolutionWebhook(String(connection?._id), credentials!.webhookSecret,
    { ...body, instance: 'other-app' })).toEqual({ error: 'UNAUTHORIZED' })
  expect(await ingestEvolutionWebhook(String(connection?._id), credentials!.webhookSecret, body))
    .toMatchObject({ accepted: true, duplicate: false })
  expect(await ingestEvolutionWebhook(String(connection?._id), credentials!.webhookSecret, body))
    .toMatchObject({ accepted: true, duplicate: true })
  const row = await WebhookInboxModel.findOne({ provider: 'evolution', connectionId: connection?._id,
    messageIds: 'EV-1' })
  expect(JSON.stringify(row)).not.toContain(credentials!.webhookSecret)
  expect(JSON.stringify(row)).not.toContain('must-not-persist')
  await processWebhookInbox(String(row?._id))
  expect((await DeliveryModel.findById(own.id)).media.receiptStatus).toBe('Read')
  expect((await DeliveryModel.findById(other.id)).media.receiptStatus).toBeUndefined()
})

test('quota de tentativa conta segredo inválido, ID inválido e duplicata antes da autenticação', async () => {
  process.env.WEBHOOK_ATTEMPT_LIMIT = '2'
  const connection = await EvolutionConnectionModel.findOne({ organizationId, channel: 'baileys' })
  const credentials = await evolutionCredentials(organizationId, String(connection?._id))
  const body = { event: 'messages.update', instance: connection?.instanceName,
    data: { keyId: `ATTEMPT-${randomUUID()}`, status: 'READ' } }
  const attempt = async (connectionId: string, secret: string, sourceIp: string) =>
    await allowEvolutionWebhookAttempt(sourceIp)
      ? ingestEvolutionWebhook(connectionId, secret, body)
      : { error: 'RATE_LIMIT' as const }
  try {
    const invalidIdIp = '203.0.113.81'
    expect(await attempt('invalid', 'wrong-secret', invalidIdIp)).toEqual({ error: 'UNAUTHORIZED' })
    expect(await attempt('invalid', 'wrong-secret', invalidIdIp)).toEqual({ error: 'UNAUTHORIZED' })
    expect(await attempt('invalid', 'wrong-secret', invalidIdIp)).toEqual({ error: 'RATE_LIMIT' })

    const invalidSecretIp = '203.0.113.82'
    expect(await attempt(String(connection?._id), 'wrong-secret', invalidSecretIp)).toEqual({ error: 'UNAUTHORIZED' })
    expect(await attempt(String(connection?._id), 'wrong-secret', invalidSecretIp)).toEqual({ error: 'UNAUTHORIZED' })
    expect(await attempt(String(connection?._id), 'wrong-secret', invalidSecretIp)).toEqual({ error: 'RATE_LIMIT' })

    const duplicateIp = '203.0.113.83'
    expect(await attempt(String(connection?._id), credentials!.webhookSecret, duplicateIp))
      .toMatchObject({ accepted: true, duplicate: false })
    expect(await attempt(String(connection?._id), credentials!.webhookSecret, duplicateIp))
      .toMatchObject({ accepted: true, duplicate: true })
    expect(await attempt(String(connection?._id), credentials!.webhookSecret, duplicateIp)).toEqual({ error: 'RATE_LIMIT' })
  } finally {
    delete process.env.WEBHOOK_ATTEMPT_LIMIT
  }
})

test('remoção exige ausência remota confirmada e permite repetição após falha', async () => {
  const tenant = String((await OrganizationModel.create({ name: 'Remoção Evolution' }))._id)
  const created = await createEvolutionConnection(tenant, { channel: 'baileys' })
  if (!('connection' in created)) throw new Error('Reserva falhou')
  const id = created.connection.id
  expect(await provisionEvolutionConnection(tenant, id)).toHaveProperty('connection')
  expect(await retireEvolutionConnection(tenant, id, { createClient: config => ({
    ...createEvolutionClient(config), deleteInstance: async () => { throw new Error('Falha remota') },
  }) })).toEqual({ error: 'UNAVAILABLE' })
  expect((await EvolutionConnectionModel.findById(id))?.archivedAt).toBeUndefined()
  expect(await selectActiveConnection(tenant, id)).toEqual({ error: 'NOT_FOUND' })
  expect(await retireEvolutionConnection(tenant, id)).toEqual({ removed: true })
  expect((await EvolutionConnectionModel.findById(id))?.archivedAt).toBeInstanceOf(Date)
  expect(await createEvolutionConnection(tenant, { channel: 'baileys' })).toHaveProperty('connection')
  expect(await EvolutionConnectionModel.countDocuments({ organizationId: tenant, channel: 'baileys' })).toBe(2)
})
