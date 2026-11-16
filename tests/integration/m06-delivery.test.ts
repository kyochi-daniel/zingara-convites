import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createEvolutionClient } from '../../packages/integrations/src/index'
import { assistantContext, approveInitialDelivery, createEvolutionConnection, evolutionCredentials, listDispatchableDeliveryIds,
  previewInitialDeliveries, previewInitialDelivery, processDelivery, provisionEvolutionConnection, revisePublishedEvent,
  saveEvolutionTemplate, selectActiveConnection } from '../../packages/core/src/index'
import { connectDatabase, DeliveryModel, EvolutionConnectionModel, GuestModel, InvitationModel } from '../../packages/database/src/index'
import { defaultTemplate } from '../../packages/contracts/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.INVITE_LINK_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m06-delivery-link`).digest('base64')
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m06-delivery-credential`).digest('base64')
process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test'
process.env.EVOLUTION_MODE = 'fake'
const email = 'm06-delivery@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m06-delivery-admin`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string
let eventId: string
let guestId: string
let invitationId: string
let deliveryId: string

async function request(path: string, method = 'GET', body?: unknown, authenticated = true, tokenHeader = csrf) {
  return fetch(`${base}${path}`, {
    method, headers: { ...(authenticated ? { cookie } : {}),
      ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': tokenHeader }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
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
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: String(address.port) }, stdio: 'ignore',
  })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break } }
    catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('API não iniciou')
  const login = await fetch(`${base}/admin/auth/login`, {
    method: 'POST', headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await json(login)).csrfToken
  org = (await json(await request('/admin/organizations', 'POST', { name: 'M06 entrega' }))).organization.id
  guestId = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', {
    name: 'Ana', phone: '+5567999999999', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado',
  }))).guest.id
  const event = { name: 'Festa', location: 'Jardim', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
    endsAt: '2027-01-03T02:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 2, companionNamesRequired: true }
  eventId = (await json(await request(`/admin/organizations/${org}/events`, 'POST', event))).event.id
  const templatePath = `/admin/organizations/${org}/events/${eventId}/template`
  expect((await request(templatePath, 'PUT', defaultTemplate)).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  invitationId = (await json(await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', { guestId }))).invitation.id
  const connection = await createEvolutionConnection(org, { channel: 'baileys' })
  if (!('connection' in connection)) throw new Error('Conexão Evolution indisponível')
  expect(await provisionEvolutionConnection(org, connection.connection.id)).toHaveProperty('connection')
  expect(await selectActiveConnection(org, connection.connection.id)).toHaveProperty('connection')
  await connectDatabase()
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('prévia exige sessão, aprovação explícita e hash atual; outbox é única', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/deliveries`
  expect((await request(`${path}/preview?invitationId=${invitationId}`, 'GET', undefined, false)).status).toBe(401)
  const previewResponse = await request(`${path}/preview?invitationId=${invitationId}`)
  expect(previewResponse.status).toBe(200)
  const { preview } = await json(previewResponse)
  expect(preview.recipient).toMatchObject({ name: 'Ana', phone: '+5567999999999', whatsappConsent: true })
  expect(preview.template).toEqual(defaultTemplate)
  expect(preview.text).toContain(preview.link)
  expect(preview.mode).toBe('fake')
  expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/)
  expect((await request(path, 'POST', { invitationId, approve: true }, true)).status).toBe(400)
  expect((await request(path, 'POST', { invitationId, approve: true, previewHash: '0'.repeat(64) })).status).toBe(409)
  expect((await request(path, 'POST', { invitationId, approve: true, previewHash: preview.previewHash }, true, '')).status).toBe(403)
  const approved = await request(path, 'POST', { invitationId, approve: true, previewHash: preview.previewHash })
  expect(approved.status).toBe(201)
  const delivery = (await json(approved)).delivery
  deliveryId = delivery.id
  expect(delivery).toMatchObject({ invitationId, status: 'queued', media: { status: 'pending' }, text: { status: 'pending' } })
  const repeat = await request(path, 'POST', { invitationId, approve: true, previewHash: preview.previewHash })
  expect(repeat.status).toBe(200)
  expect((await json(repeat)).delivery.id).toBe(deliveryId)
  expect(await DeliveryModel.countDocuments({ invitationId, type: 'initial', templateVersion: 1 })).toBe(1)
  const listed = await json(await request(path))
  expect(JSON.stringify(listed)).not.toContain(preview.link)
  expect(listed.items[0].id).toBe(deliveryId)
}, 20_000)

test('worker fake envia mídia/texto em partes e não repete aceite', async () => {
  let renders = 0
  await processDelivery(deliveryId, {
    renderMedia: async (_invitationId: string, _templateVersion: number, link: string) => {
      renders++
      expect(link).toContain('/i/')
      return { url: `${process.env.INVITE_ORIGIN}/media/test.webp`, expiresAt: new Date(Date.now() + 600_000) }
    },
  })
  const doc = await DeliveryModel.findById(deliveryId)
  expect(doc.status).toBe('completed')
  expect(doc.media.status).toBe('accepted')
  expect(doc.text.status).toBe('accepted')
  expect(doc.media.messageId).toBeTruthy()
  expect(doc.text.messageId).toBeTruthy()
  expect(renders).toBe(1)
  expect(doc.attempts).toHaveLength(2)
  await processDelivery(deliveryId, { renderMedia: async () => { throw new Error('não deve renderizar') } })
  expect((await DeliveryModel.findById(deliveryId)).attempts).toHaveLength(2)
}, 20_000)

test('prévia usa mensagem publicada, dados individuais e prazo efetivo; rascunho não altera aprovação', async () => {
  const event = (await json(await request(`/admin/organizations/${org}/events`, 'POST', {
    name: 'Evento da mensagem', location: 'Jardim', address: 'Rua A',
    startsAt: '2027-01-02T20:00:00-04:00', endsAt: '2027-01-03T02:00:00-04:00',
    rsvpDeadline: '2027-01-01T20:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 1, companionNamesRequired: false,
  }))).event.id
  const templatePath = `/admin/organizations/${org}/events/${event}/template`
  const message = 'V1: {{convidado.nome}} · {{evento.nome}} · {{evento.data}} às {{evento.horario}} · {{evento.fuso}} · até {{evento.prazo_confirmacao}} · {{convite.link}}'
  const template = { ...defaultTemplate, body: 'Texto exclusivo da arte', message }
  expect((await request(templatePath, 'PUT', template)).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  const issued = await json(await request(`/admin/organizations/${org}/events/${event}/invitations`, 'POST', {
    guestId, expiresAt: '2027-01-01T18:30:00-04:00',
  }))
  const path = `/admin/organizations/${org}/events/${event}/deliveries`
  const preview = (await json(await request(`${path}/preview?invitationId=${issued.invitation.id}`))).preview
  expect(preview.text).toBe(`V1: Ana · Evento da mensagem · 2 de janeiro de 2027 às 20:00 · Horário de Ponta Porã · até 1 de janeiro de 2027, às 18:30 · ${issued.link}`)
  expect(preview.text).not.toContain(template.body)
  expect((await request(templatePath, 'PUT', { ...template, message: 'V2: {{convidado.nome}} · {{convite.link}}' })).status).toBe(200)
  const unchanged = (await json(await request(`${path}/preview?invitationId=${issued.invitation.id}`))).preview
  expect(unchanged.text).toBe(preview.text)
  expect(unchanged.previewHash).toBe(preview.previewHash)
  expect((await request(path, 'POST', { invitationId: issued.invitation.id, approve: true, previewHash: preview.previewHash })).status).toBe(201)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  const secondGuest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', {
    name: 'Bia da mensagem', phone: '+5567999999911', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado',
  }))).guest.id
  const second = await json(await request(`/admin/organizations/${org}/events/${event}/invitations`, 'POST', { guestId: secondGuest }))
  const next = (await json(await request(`${path}/preview?invitationId=${second.invitation.id}`))).preview
  expect(next.text).toBe(`V2: Bia da mensagem · ${second.link}`)
  expect(next.link).not.toBe(preview.link)
  expect(next.renderData['evento.prazo_confirmacao']).toBe('1 de janeiro de 2027, às 20:00')
  expect((await json(await request(`${path}/preview?invitationId=${issued.invitation.id}`))).preview.text).toBe(preview.text)
  const publicInvitation = await json(await fetch(`${base}/public/invitations/${new URL(issued.link).pathname.split('/').at(-1)}`))
  expect(JSON.stringify(publicInvitation)).not.toContain(message)
  const listed = await json(await request(path))
  expect(JSON.stringify(listed)).not.toContain(issued.link)
  expect(JSON.stringify(await DeliveryModel.findOne({ invitationId: issued.invitation.id }).lean())).not.toContain(issued.link)
  const context = await assistantContext(org, 'convites e eventos')
  expect(JSON.stringify(context)).not.toContain(issued.link)
  expect(JSON.stringify(context)).not.toContain(message)
}, 20_000)

test('prévia e elegibilidade usam datas atuais do evento mesmo com convite persistido antigo', async () => {
  const now = Date.now()
  const startsAt = new Date(now + 10 * 86_400_000)
  const oldEndsAt = new Date(now + 12 * 86_400_000)
  const newEndsAt = new Date(now + 11 * 86_400_000)
  const oldDeadline = new Date(now + 9 * 86_400_000)
  const newDeadline = new Date(now + 8 * 86_400_000)
  const event = (await json(await request(`/admin/organizations/${org}/events`, 'POST', {
    name: 'Evento revisado', location: 'Jardim', address: 'Rua A',
    startsAt: startsAt.toISOString(), endsAt: oldEndsAt.toISOString(),
    rsvpDeadline: oldDeadline.toISOString(), timeZone: 'America/Campo_Grande',
    companionLimit: 0, companionNamesRequired: false,
  }))).event.id
  const templatePath = `/admin/organizations/${org}/events/${event}/template`
  expect((await request(templatePath, 'PUT', defaultTemplate)).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  const issued = await json(await request(`/admin/organizations/${org}/events/${event}/invitations`, 'POST', { guestId }))
  expect(await revisePublishedEvent(org, event, { expectedRevision: 0, changes: {
    endsAt: newEndsAt.toISOString(), rsvpDeadline: newDeadline.toISOString(),
  } })).toHaveProperty('event.rsvpDeadline', newDeadline.toISOString())
  await InvitationModel.updateOne({ _id: issued.invitation.id }, { $set: {
    expiresAt: oldEndsAt, rsvpDeadline: oldDeadline,
  } })

  const batch = await previewInitialDeliveries(org, event, [issued.invitation.id])
  expect(batch).toHaveProperty('previews.0.eligibleUntil', newDeadline.toISOString())
  if (!('previews' in batch)) throw new Error('Prévia em lote indisponível')
  expect(batch.previews[0].text).toContain(batch.previews[0].renderData['evento.prazo_confirmacao'])

  const pastDeadline = new Date(now - 60_000)
  expect(await revisePublishedEvent(org, event, { expectedRevision: 1,
    changes: { rsvpDeadline: pastDeadline.toISOString() } })).toHaveProperty('event.rsvpDeadline', pastDeadline.toISOString())
  await InvitationModel.updateOne({ _id: issued.invitation.id }, { $set: { rsvpDeadline: oldDeadline } })
  expect(await previewInitialDelivery(org, event, issued.invitation.id)).toEqual({ error: 'INELIGIBLE' })
}, 20_000)

test('revogação após aprovação suprime envio antes do provedor', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/deliveries`
  const secondGuest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', {
    name: 'Bia', phone: '+5567888888888', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado',
  }))).guest.id
  const secondInvite = (await json(await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', { guestId: secondGuest }))).invitation.id
  const preview = (await json(await request(`${path}/preview?invitationId=${secondInvite}`))).preview
  const secondDelivery = (await json(await request(path, 'POST', { invitationId: secondInvite, approve: true, previewHash: preview.previewHash }))).delivery.id
  await InvitationModel.updateOne({ _id: secondInvite }, { $set: { revokedAt: new Date() } })
  let sent = false
  await processDelivery(secondDelivery, { renderMedia: async () => { sent = true; throw new Error('não deve renderizar') },
    createEvolutionClient: () => { sent = true; throw new Error('não deve criar cliente') } })
  expect(sent).toBe(false)
  expect((await DeliveryModel.findById(secondDelivery)).status).toBe('suppressed')
}, 20_000)

test('timeout após iniciar envio fica incerto e fora da fila automática', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/deliveries`
  const timeoutGuest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', {
    name: 'Cris', phone: '+5567777777777', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado',
  }))).guest.id
  const timeoutInvite = (await json(await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', { guestId: timeoutGuest }))).invitation.id
  const preview = (await json(await request(`${path}/preview?invitationId=${timeoutInvite}`))).preview
  const timeoutDelivery = (await json(await request(path, 'POST', {
    invitationId: timeoutInvite, approve: true, previewHash: preview.previewHash,
  }))).delivery.id
  const connection = await EvolutionConnectionModel.findOne({ organizationId: org, channel: 'baileys' })
  const credentials = await evolutionCredentials(org, connection!.id)
  const client = createEvolutionClient({ baseUrl: process.env.EVOLUTION_BASE_URL!,
    instanceName: connection!.instanceName, token: credentials!.instanceToken, channel: 'baileys', mode: 'fake' })
  let sends = 0
  client.sendMedia = async () => { sends++; throw new Error('timeout incerto') }
  const deps = { renderMedia: async () => ({ url: `${process.env.INVITE_ORIGIN}/media/test.webp`,
    expiresAt: new Date(Date.now() + 600_000) }), createEvolutionClient: () => client }
  await processDelivery(timeoutDelivery, deps)
  const uncertain = await DeliveryModel.findById(timeoutDelivery)
  expect(uncertain.status).toBe('uncertain')
  expect(uncertain.media.status).toBe('uncertain')
  expect(uncertain.attempts[0].outcome).toBe('uncertain')
  expect((await listDispatchableDeliveryIds()).includes(timeoutDelivery)).toBe(false)
  await processDelivery(timeoutDelivery, deps)
  expect(sends).toBe(1)
}, 20_000)

async function approveGuestDelivery(name: string, phone: string) {
  const path = `/admin/organizations/${org}/events/${eventId}/deliveries`
  const guest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', {
    name, phone, whatsappConsent: true, authorizationSource: 'Formulário presencial assinado',
  }))).guest.id as string
  const invitation = (await json(await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', {
    guestId: guest,
  }))).invitation.id as string
  const preview = (await json(await request(`${path}/preview?invitationId=${invitation}`))).preview
  const delivery = (await json(await request(path, 'POST', {
    invitationId: invitation, approve: true, previewHash: preview.previewHash,
  }))).delivery.id as string
  return { guest, invitation, delivery, preview }
}

test('aprovação fake não autoriza envio real; modo real exige nova prévia e aprovação', async () => {
  const { invitation, delivery, preview } = await approveGuestDelivery('Duda', '+5567666666666')
  expect((await DeliveryModel.findById(delivery)).approvedMode).toBe('fake')
  const previousMode = process.env.EVOLUTION_MODE
  const previousRealEnabled = process.env.EVOLUTION_REAL_ENABLED
  const previousSendEnabled = process.env.EVOLUTION_REAL_SEND_ENABLED
  try {
    process.env.EVOLUTION_MODE = 'real'
    process.env.EVOLUTION_REAL_ENABLED = '1'
    process.env.EVOLUTION_REAL_SEND_ENABLED = '1'
    let called = false
    await processDelivery(delivery, { renderMedia: async () => { called = true; throw new Error('não deve renderizar') },
      createEvolutionClient: () => { called = true; throw new Error('não deve criar cliente') } })
    expect(called).toBe(false)
    expect((await DeliveryModel.findById(delivery)).status).toBe('suppressed')
    const realPreview = await previewInitialDelivery(org, eventId, invitation)
    expect('preview' in realPreview).toBe(true)
    if (!('preview' in realPreview)) return
    expect(realPreview.preview.mode).toBe('real')
    expect(realPreview.preview.previewHash).not.toBe(preview.previewHash)
    expect(await approveInitialDelivery(org, eventId, { invitationId: invitation, approve: true,
      previewHash: preview.previewHash })).toEqual({ error: 'CONFLICT' })
    const reapproved = await approveInitialDelivery(org, eventId, { invitationId: invitation, approve: true,
      previewHash: realPreview.preview.previewHash })
    expect('delivery' in reapproved).toBe(true)
    expect((await DeliveryModel.findById(delivery)).approvedMode).toBe('real')
    expect((await DeliveryModel.findById(delivery)).status).toBe('queued')
  } finally {
    process.env.EVOLUTION_MODE = previousMode
    if (previousRealEnabled === undefined) delete process.env.EVOLUTION_REAL_ENABLED
    else process.env.EVOLUTION_REAL_ENABLED = previousRealEnabled
    if (previousSendEnabled === undefined) delete process.env.EVOLUTION_REAL_SEND_ENABLED
    else process.env.EVOLUTION_REAL_SEND_ENABLED = previousSendEnabled
  }
}, 20_000)

test('mudança de consentimento durante arte impede chamada ao provedor', async () => {
  const { guest, delivery } = await approveGuestDelivery('Eva', '+5567555555555')
  let sends = 0
  const connection = await EvolutionConnectionModel.findOne({ organizationId: org, channel: 'baileys' })
  const credentials = await evolutionCredentials(org, connection!.id)
  const client = createEvolutionClient({ baseUrl: process.env.EVOLUTION_BASE_URL!,
    instanceName: connection!.instanceName, token: credentials!.instanceToken, channel: 'baileys', mode: 'fake' })
  client.sendMedia = async () => { sends++; return { messageId: 'unexpected', status: 'sent' } }
  await processDelivery(delivery, { renderMedia: async () => {
    await GuestModel.updateOne({ _id: guest }, { $set: { whatsappConsent: false } })
    return { url: `${process.env.INVITE_ORIGIN}/media/test.webp`, expiresAt: new Date(Date.now() + 600_000) }
  }, createEvolutionClient: () => client })
  expect(sends).toBe(0)
  expect((await DeliveryModel.findById(delivery)).status).toBe('suppressed')
  expect((await DeliveryModel.findById(delivery)).attempts).toHaveLength(0)
}, 20_000)

test('troca da identidade da conexão durante arte impede envio', async () => {
  const { delivery } = await approveGuestDelivery('Fê', '+5567444444444')
  let sends = 0
  const original = await EvolutionConnectionModel.findOne({ organizationId: org, channel: 'baileys' })
  const credentials = await evolutionCredentials(org, original!.id)
  const client = createEvolutionClient({ baseUrl: process.env.EVOLUTION_BASE_URL!,
    instanceName: original!.instanceName, token: credentials!.instanceToken, channel: 'baileys', mode: 'fake' })
  client.sendMedia = async () => { sends++; return { messageId: 'unexpected', status: 'sent' } }
  const cloud = await createEvolutionConnection(org, { channel: 'cloud', metaToken: 'meta-token-for-rotation-test',
    phoneNumberId: '123456789012', businessId: '234567890123' })
  if (!('connection' in cloud)) throw new Error('Conexão oficial indisponível')
  expect(await provisionEvolutionConnection(org, cloud.connection.id)).toHaveProperty('connection')
  expect(await saveEvolutionTemplate(org, cloud.connection.id,
    { type: 'initial', name: 'convite_01', language: 'pt_BR' })).toHaveProperty('template')
  await processDelivery(delivery, { renderMedia: async () => {
    expect(await selectActiveConnection(org, cloud.connection.id)).toHaveProperty('connection')
    return { url: `${process.env.INVITE_ORIGIN}/media/test.webp`, expiresAt: new Date(Date.now() + 600_000) }
  }, createEvolutionClient: () => client })
  expect(sends).toBe(0)
  expect((await DeliveryModel.findById(delivery)).status).toBe('suppressed')
  expect((await DeliveryModel.findById(delivery)).attempts).toHaveLength(0)
}, 20_000)
