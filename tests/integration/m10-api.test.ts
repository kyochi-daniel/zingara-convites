import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, DeliveryModel, EvolutionConnectionModel, GuestModel, WebhookInboxModel } from '../../packages/database/src/index'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { evolutionCredentials, processDelivery, processWebhookInbox } from '../../packages/core/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m10-api`).digest('base64')
delete process.env.EVOLUTION_BASE_URL
process.env.EVOLUTION_MODE = 'fake'
const email = 'm10@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m10-admin`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string
let otherOrg: string

async function request(path: string, method = 'GET', body?: unknown, authenticated = true, tokenHeader = csrf) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(authenticated ? { cookie } : {}),
    ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': tokenHeader }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function json(response: Response) { return response.json() as Promise<any> }

beforeAll(async () => {
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => server.close(resolve))
  base = `http://127.0.0.1:${address.port}`
  api = spawn(process.execPath, ['apps/api/.output/server/index.mjs'], {
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: String(address.port), WEBHOOK_ATTEMPT_LIMIT: '2' }, stdio: 'ignore',
  })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break } }
    catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('API não iniciou')
  const login = await fetch(`${base}/admin/auth/login`, { method: 'POST',
    headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await json(login)).csrfToken
  org = (await json(await request('/admin/organizations', 'POST', { name: 'M10' }))).organization.id
  otherOrg = (await json(await request('/admin/organizations', 'POST', { name: 'M10 outra' }))).organization.id
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('criação, diagnóstico e seleção respeitam sessão, CSRF e organização', async () => {
  const path = `/admin/organizations/${org}/connections/evolution`
  expect((await request(path, 'POST', { channel: 'baileys' }, false)).status).toBe(401)
  expect((await request(path, 'POST', { channel: 'baileys' }, true, '')).status).toBe(403)
  expect((await request(path, 'POST', { channel: 'baileys', instanceName: 'other-app' })).status).toBe(400)
  const created = await request(path, 'POST', { channel: 'baileys' })
  expect(created.status).toBe(200)
  const connection = (await json(created)).connection
  expect(connection).toMatchObject({ provider: 'evolution', channel: 'baileys', state: 'ready' })
  expect(JSON.stringify(connection)).not.toContain('Ciphertext')
  expect((await json(await request(path))).connections).toHaveLength(1)
  expect((await request(`/admin/organizations/${otherOrg}/connections/evolution/${connection.id}/status`)).status).toBe(404)
  const activePath = `/admin/organizations/${org}/connections/active`
  expect((await json(await request(activePath))).active).toBeNull()
  expect((await request(activePath, 'PUT', { provider: 'evolution', connectionId: connection.id, revision: 1 })).status).toBe(409)
  const selected = await request(activePath, 'PUT', { provider: 'evolution', connectionId: connection.id, revision: 0 })
  expect(selected.status).toBe(200)
  expect((await json(selected)).connection).toMatchObject({ connectionId: connection.id, revision: 1 })
  expect((await json(await request(activePath))).active.revision).toBe(1)
  expect((await request(`${path}/${connection.id}/number-check`, 'POST', { phone: '+5567999999999' })).status).toBe(200)
  expect((await request(`${path}/${connection.id}/connect`, 'POST', {})).status).toBe(200)
  expect((await json(await request(`${path}/${connection.id}/status`))).status.state).toBe('connecting')
  expect((await request(`${path}/${connection.id}`, 'DELETE')).status).toBe(409)
}, 20_000)

test('canal oficial exige template mapeado e não apresenta segredo', async () => {
  const path = `/admin/organizations/${otherOrg}/connections/evolution`
  const token = 'private-meta-token-for-api-test'
  const created = await request(path, 'POST', { channel: 'cloud', metaToken: token,
    phoneNumberId: '123456789012', businessId: '234567890123' })
  expect(created.status).toBe(200)
  const connection = (await json(created)).connection
  expect(connection.channel).toBe('cloud')
  expect(JSON.stringify(connection)).not.toContain(token)
  expect((await request(`${path}/${connection.id}/connect`, 'POST', {})).status).toBe(409)
  expect((await request(`${path}/${connection.id}/number-check`, 'POST', { phone: '+5567999999999' })).status).toBe(409)
  expect((await request(`${path}/${connection.id}/templates`, 'PUT', { type: 'initial', name: 'convite_01', language: 'pt_BR' })).status).toBe(200)
  expect((await json(await request(`${path}/${connection.id}/templates`))).templates)
    .toMatchObject([{ type: 'initial', name: 'convite_01', status: 'approved' }])
  expect((await request('/webhooks/uazapi', 'POST', {})).status).toBe(404)
}, 20_000)

async function invitationFor(organizationId: string, phone: string) {
  const guest = (await json(await request(`/admin/organizations/${organizationId}/guests`, 'POST',
    { name: 'Ana', phone, whatsappConsent: true, authorizationSource: 'Formulário presencial assinado' }))).guest.id as string
  const event = (await json(await request(`/admin/organizations/${organizationId}/events`, 'POST', {
    name: 'Festa', location: 'Jardim', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
    endsAt: '2027-01-03T02:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 2, companionNamesRequired: true,
  }))).event.id as string
  const templatePath = `/admin/organizations/${organizationId}/events/${event}/template`
  expect((await request(templatePath, 'PUT', defaultTemplate)).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  const invitation = (await json(await request(`/admin/organizations/${organizationId}/events/${event}/invitations`,
    'POST', { guestId: guest }))).invitation.id as string
  return { event, invitation }
}

test('prévia e verificação de números exigem sessão, origem, CSRF e conexão própria', async () => {
  await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ organizationId: org, channel: 'baileys' })
  const path = `/admin/organizations/${org}/connections/evolution/${connection!.id}`
  const phones = ['+5567999999999']
  for (const action of ['numbers-preview', 'numbers-verify']) {
    const body = { phones, ...(action === 'numbers-verify' ? { confirm: true } : {}) }
    expect((await request(`${path}/${action}`, 'POST', body, false)).status).toBe(401)
    expect((await request(`${path}/${action}`, 'POST', body, true, 'wrong')).status).toBe(403)
    expect((await fetch(`${base}${path}/${action}`, { method: 'POST', headers: {
      cookie, origin: 'https://evil.test', 'x-csrf-token': csrf, 'content-type': 'application/json',
    }, body: JSON.stringify(body) })).status).toBe(403)
    expect((await request(`${path}/${action}`.replace(org, otherOrg), 'POST', body)).status).toBe(404)
    expect((await request(`${path}/${action}`, 'POST', { ...body, instanceName: 'foreign-app' })).status).toBe(400)
  }
  expect((await request(`${path}/numbers-verify`, 'POST', { phones })).status).toBe(400)
  expect((await request(`${path}/numbers-verify`, 'POST', { phones: Array(11).fill(phones[0]), confirm: true })).status).toBe(400)
  const preview = await request(`${path}/numbers-preview`, 'POST', { phones: [...phones, '123'] })
  expect(preview.status).toBe(200)
  expect(preview.headers.get('cache-control')).toBe('private, no-store')
  expect(await json(preview)).toMatchObject({ mode: 'fake', results: [{ state: 'not_checked' }, { state: 'invalid_format' }] })
  const checked = await request(`${path}/numbers-verify`, 'POST', { phones, confirm: true })
  expect(checked.status).toBe(200)
  expect(await json(checked)).toMatchObject({ results: [{ state: 'registered', checkedAt: expect.any(String),
    connection: { id: connection!.id, revision: 1 } }] })
  const official = await EvolutionConnectionModel.findOne({ organizationId: otherOrg, channel: 'cloud' })
  expect((await request(`/admin/organizations/${otherOrg}/connections/evolution/${official!.id}/numbers-verify`,
    'POST', { phones, confirm: true })).status).toBe(409)
}, 20_000)

test('Baileys fake envia mídia e texto; Cloud fake envia somente template aprovado', async () => {
  const baileys = await invitationFor(org, '+5567999999999')
  const path = `/admin/organizations/${org}/events/${baileys.event}/deliveries`
  const preview = (await json(await request(`${path}/preview?invitationId=${baileys.invitation}`))).preview
  expect(preview.channel).toBe('baileys')
  const approved = await request(path, 'POST', { invitationId: baileys.invitation, approve: true,
    previewHash: preview.previewHash })
  expect(approved.status).toBe(201)
  const deliveryId = (await json(approved)).delivery.id
  await processDelivery(deliveryId, { renderMedia: async () => ({
    url: `${process.env.INVITE_ORIGIN}/media/test.webp`, expiresAt: new Date(Date.now() + 600_000),
  }) })
  expect(await DeliveryModel.findById(deliveryId)).toMatchObject({ status: 'completed',
    media: { status: 'accepted' }, text: { status: 'accepted' } })

  const cloud = (await json(await request(`/admin/organizations/${otherOrg}/connections/evolution`))).connections[0]
  expect((await request(`/admin/organizations/${otherOrg}/connections/active`, 'PUT',
    { provider: 'evolution', connectionId: cloud.id, revision: 0 })).status).toBe(200)
  const official = await invitationFor(otherOrg, '+5567888888888')
  const officialPath = `/admin/organizations/${otherOrg}/events/${official.event}/deliveries`
  const officialPreview = (await json(await request(`${officialPath}/preview?invitationId=${official.invitation}`))).preview
  expect(officialPreview.officialTemplate.name).toBe('convite_01')
  const officialApproved = await request(officialPath, 'POST', { invitationId: official.invitation,
    approve: true, previewHash: officialPreview.previewHash })
  expect(officialApproved.status).toBe(201)
  const officialId = (await json(officialApproved)).delivery.id
  await processDelivery(officialId, { renderMedia: async () => { throw new Error('Cloud não renderiza mídia livre') } })
  expect(await DeliveryModel.findById(officialId)).toMatchObject({ status: 'completed',
    media: { status: 'skipped' }, text: { status: 'accepted' }, approvedTemplateName: 'convite_01' })
}, 20_000)

test('webhook público autentica segredo, limita corpo e aplica recibo e PARAR', async () => {
  const connection = await EvolutionConnectionModel.findOne({ organizationId: org, channel: 'baileys' })
  const credentials = await evolutionCredentials(org, connection!.id)
  const delivery = await DeliveryModel.findOne({ organizationId: org, approvedProvider: 'evolution',
    'media.messageId': { $exists: true } })
  const path = `/webhooks/evolution/${connection!.id}`
  const body = { event: 'messages.update', instance: connection!.instanceName,
    data: { keyId: delivery!.media.messageId, status: 'READ' } }
  const webhook = (payload: unknown, secret = credentials!.webhookSecret,
    sourceIp = '203.0.113.44', target = path) => fetch(`${base}${target}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-zingara-webhook-secret': secret,
      'x-client-ip': sourceIp },
    body: JSON.stringify(payload),
  })
  expect((await webhook(body, 'wrong-secret', '203.0.113.40', '/webhooks/evolution/invalid')).status).toBe(401)
  expect((await webhook(body, 'wrong-secret', '203.0.113.40', '/webhooks/evolution/invalid')).status).toBe(401)
  expect((await webhook(body, 'wrong-secret', '203.0.113.40', '/webhooks/evolution/invalid')).status).toBe(429)
  expect((await webhook(body, 'wrong-secret', '203.0.113.41')).status).toBe(401)
  expect((await webhook(body, 'wrong-secret', '203.0.113.41')).status).toBe(401)
  expect((await webhook(body, 'wrong-secret', '203.0.113.41')).status).toBe(429)
  expect((await webhook({ ...body, instance: 'other-app' }, credentials!.webhookSecret, '203.0.113.42')).status).toBe(401)
  expect((await webhook({ ...body, padding: 'x'.repeat(262_144) }, credentials!.webhookSecret,
    '203.0.113.43')).status).toBe(413)
  expect((await webhook(body)).status).toBe(202)
  expect((await webhook(body)).status).toBe(202)
  expect((await webhook({ ...body, padding: 'x'.repeat(262_144) })).status).toBe(429)
  const receipt = await WebhookInboxModel.findOne({ provider: 'evolution', connectionId: connection!._id,
    kind: 'messages_update' })
  expect(receipt).toBeTruthy()
  await processWebhookInbox(receipt!.id)
  expect((await DeliveryModel.findById(delivery!.id)).media.receiptStatus).toBe('Read')
  const optOut = { event: 'messages.upsert', instance: connection!.instanceName,
    data: { key: { id: 'OPT-1', remoteJid: '5567999999999@s.whatsapp.net', fromMe: false },
      message: { conversation: 'PARAR' } } }
  expect((await webhook(optOut, credentials!.webhookSecret, '203.0.113.45')).status).toBe(202)
  const row = await WebhookInboxModel.findOne({ provider: 'evolution', connectionId: connection!._id,
    kind: 'messages' })
  await processWebhookInbox(row!.id)
  expect((await GuestModel.findOne({ organizationId: org, phone: '+5567999999999' })).whatsappConsent).toBe(false)
  expect((await GuestModel.findOne({ organizationId: otherOrg, phone: '+5567888888888' })).whatsappConsent).toBe(true)
}, 20_000)
