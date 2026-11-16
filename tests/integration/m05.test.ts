import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, EventModel, InvitationModel } from '../../packages/database/src/index'
import { defaultTemplate } from '../../packages/contracts/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.INVITE_LINK_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m05-link-key`).digest('base64')
const email = 'm05@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m05-admin`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string
let otherOrg: string
let eventId: string
let draftEventId: string
let guestId: string
let otherGuestId: string
let invitationId: string
let token: string

async function request(path: string, method = 'GET', body?: unknown, authenticated = true, tokenHeader = csrf) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(authenticated ? { cookie } : {}),
      ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': tokenHeader }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function publicRequest(path: string, method = 'GET', body?: unknown) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(method === 'GET' ? {} : { origin: process.env.INVITE_ORIGIN! }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function json(response: Response) { return response.json() as Promise<any> }
function extractToken(link: string) { return new URL(link).pathname.split('/').pop()! }

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
  org = (await json(await request('/admin/organizations', 'POST', { name: 'M05' }))).organization.id
  otherOrg = (await json(await request('/admin/organizations', 'POST', { name: 'M05 outra' }))).organization.id
  guestId = (await json(await request(`/admin/organizations/${org}/guests`, 'POST', { name: 'Ana', phone: '+5567999999999' }))).guest.id
  otherGuestId = (await json(await request(`/admin/organizations/${otherOrg}/guests`, 'POST', { name: 'Bia', phone: '+5567888888888' }))).guest.id
  const event = { name: 'Festa', location: 'Jardim', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
    endsAt: '2027-01-03T02:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 2, companionNamesRequired: true }
  eventId = (await json(await request(`/admin/organizations/${org}/events`, 'POST', event))).event.id
  draftEventId = (await json(await request(`/admin/organizations/${org}/events`, 'POST', { ...event, name: 'Rascunho' }))).event.id
  const templatePath = `/admin/organizations/${org}/events/${eventId}/template`
  expect((await request(templatePath, 'PUT', defaultTemplate)).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  await connectDatabase()
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('emite somente para evento publicado e convidado da organização; repete sem alterar versão', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/invitations`
  expect((await request(path, 'POST', { guestId }, false)).status).toBe(401)
  expect((await request(path, 'POST', { guestId }, true, '')).status).toBe(403)
  expect((await request(`/admin/organizations/${org}/events/${draftEventId}/invitations`, 'POST', { guestId })).status).toBe(409)
  expect((await request(path, 'POST', { guestId: otherGuestId })).status).toBe(404)
  expect((await request(`/admin/organizations/${otherOrg}/events/${eventId}/invitations`, 'POST', { guestId })).status).toBe(404)
  expect((await request(path, 'POST', { guestId, extra: true })).status).toBe(400)
  const first = await request(path, 'POST', { guestId })
  expect(first.status).toBe(201)
  const created = await json(first)
  invitationId = created.invitation.id
  token = extractToken(created.link)
  expect(token.length).toBeGreaterThanOrEqual(43)
  expect(created.invitation.templateVersion).toBe(1)
  const repeated = await request(path, 'POST', { guestId })
  expect(repeated.status).toBe(200)
  expect((await json(repeated)).invitation.id).toBe(invitationId)
  expect(await InvitationModel.countDocuments({ eventId, guestId })).toBe(1)
  const doc = await InvitationModel.findById(invitationId)
  expect(doc.secretHash).toBe(createHash('sha256').update(token).digest('hex'))
  expect(JSON.stringify(doc.toObject())).not.toContain(token)
  const templatePath = `/admin/organizations/${org}/events/${eventId}/template`
  expect((await request(templatePath, 'PUT', { ...defaultTemplate, title: 'Versão nova' })).status).toBe(200)
  expect((await request(`${templatePath}/publish`, 'POST')).status).toBe(201)
  expect((await json(await request(path, 'POST', { guestId }))).invitation.templateVersion).toBe(1)
  const listed = await json(await request(path))
  expect(JSON.stringify(listed)).not.toContain(token)
  expect(listed.items[0]).toMatchObject({ id: invitationId, guestId, guestName: 'Ana', templateVersion: 1 })
  expect(listed.totals).toMatchObject({ pending: 1, accepted: 0, declined: 0, peopleConfirmed: 0 })
}, 20_000)

test('GET público é inerte; RSVP confirma, é idempotente, edita e recusa', async () => {
  const path = `/public/invitations/${token}`
  const initial = await publicRequest(path)
  expect(initial.status).toBe(200)
  expect(initial.headers.get('cache-control')).toContain('no-store')
  expect(initial.headers.get('referrer-policy')).toBe('no-referrer')
  expect(initial.headers.get('x-robots-tag')).toContain('noindex')
  const data = (await json(initial)).invitation
  const { message: _message, ...publicTemplate } = defaultTemplate
  expect(data).toMatchObject({ guest: { name: 'Ana' }, event: { name: 'Festa' }, template: publicTemplate,
    response: { status: 'pending', version: 0 }, companionLimit: 2 })
  expect((await InvitationModel.findById(invitationId)).responseVersion).toBe(0)
  expect((await publicRequest(`${path}/rsvp`, 'PUT', { status: 'accepted', companions: [''], expectedVersion: 0 })).status).toBe(400)
  expect((await publicRequest(`${path}/rsvp`, 'PUT', { status: 'accepted', companions: ['Bia', 'Caio', 'Davi'], expectedVersion: 0 })).status).toBe(400)
  const accepted = await publicRequest(`${path}/rsvp`, 'PUT', { status: 'accepted', companions: ['Bia'], expectedVersion: 0 })
  expect(accepted.status).toBe(200)
  expect((await json(accepted)).response).toMatchObject({ status: 'accepted', companions: ['Bia'], version: 1, peopleCount: 2 })
  const repeat = await publicRequest(`${path}/rsvp`, 'PUT', { status: 'accepted', companions: ['Bia'], expectedVersion: 0 })
  expect((await json(repeat)).response.version).toBe(1)
  expect((await publicRequest(`${path}/rsvp`, 'PUT', { status: 'declined', companions: [], expectedVersion: 0 })).status).toBe(409)
  const declined = await publicRequest(`${path}/rsvp`, 'PUT', { status: 'declined', companions: [], expectedVersion: 1 })
  expect((await json(declined)).response).toMatchObject({ status: 'declined', companions: [], version: 2, peopleCount: 0 })
  const listed = await json(await request(`/admin/organizations/${org}/events/${eventId}/invitations`))
  expect(listed.totals).toMatchObject({ pending: 0, accepted: 0, declined: 1, peopleConfirmed: 0 })
  expect((await InvitationModel.findById(invitationId)).history).toHaveLength(2)
}, 20_000)

test('respostas simultâneas distintas preservam apenas uma mudança', async () => {
  const path = `/public/invitations/${token}/rsvp`
  const body = { status: 'accepted', expectedVersion: 2 }
  const responses = await Promise.all([
    publicRequest(path, 'PUT', { ...body, companions: [] }),
    publicRequest(path, 'PUT', { ...body, companions: ['Bia'] }),
  ])
  expect(responses.map(response => response.status).sort()).toEqual([200, 409])
  expect((await InvitationModel.findById(invitationId)).responseVersion).toBe(3)
  expect((await InvitationModel.findById(invitationId)).history).toHaveLength(3)
}, 20_000)

test('recupera link autorizado, gira segredo, revoga e impede RSVP após prazo', async () => {
  const basePath = `/admin/organizations/${org}/events/${eventId}/invitations/${invitationId}`
  expect((await request(`${basePath}/link`, 'GET', undefined, false)).status).toBe(401)
  expect((await request(`/admin/organizations/${otherOrg}/events/${eventId}/invitations/${invitationId}/link`)).status).toBe(404)
  expect(extractToken((await json(await request(`${basePath}/link`))).link)).toBe(token)
  const customExpiry = new Date('2026-12-30T00:00:00.000Z')
  await InvitationModel.updateOne({ _id: invitationId }, { $set: { expiresAt: customExpiry } })
  const rotated = await request(`${basePath}/rotate`, 'POST')
  expect(rotated.status).toBe(200)
  const newToken = extractToken((await json(rotated)).link)
  expect(newToken).not.toBe(token)
  expect((await InvitationModel.findById(invitationId)).expiresAt.toISOString()).toBe(customExpiry.toISOString())
  expect((await publicRequest(`/public/invitations/${token}`)).status).toBe(404)
  token = newToken
  await InvitationModel.updateOne({ _id: invitationId }, { $set: { expiresAt: new Date('2000-01-01') } })
  expect((await publicRequest(`/public/invitations/${token}`)).status).toBe(404)
  expect((await request(`${basePath}/rotate`, 'POST')).status).toBe(409)
  await InvitationModel.updateOne({ _id: invitationId }, { $set: { expiresAt: customExpiry } })
  await EventModel.updateOne({ _id: eventId }, { $set: { rsvpDeadline: new Date('2000-01-01') } })
  expect((await publicRequest(`/public/invitations/${token}/rsvp`, 'PUT', { status: 'accepted', companions: [], expectedVersion: 2 })).status).toBe(403)
  const revoked = await request(`${basePath}/revoke`, 'POST')
  expect(revoked.status).toBe(200)
  expect((await publicRequest(`/public/invitations/${token}`)).status).toBe(404)
  expect((await request(`${basePath}/rotate`, 'POST')).status).toBe(409)
}, 20_000)
