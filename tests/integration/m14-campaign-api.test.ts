import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { connectDatabase, DeliveryModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_campaign_api_${randomUUID().replaceAll('-', '').slice(0, 8)}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_MODE = 'fake'
process.env.EVOLUTION_CONTROL_REAL_ENABLED = '0'
process.env.EVOLUTION_REAL_ENABLED = '0'
process.env.EVOLUTION_REAL_SEND_ENABLED = '0'
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string
let otherOrg: string
let eventId: string
let invitationId: string

async function request(path: string, method = 'GET', body?: unknown, authenticated = true, tokenHeader = csrf) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(authenticated ? { cookie } : {}),
    ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': tokenHeader }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function json(response: Response) { return response.json() as Promise<any> }

beforeAll(async () => {
  const email = `campaign-${randomUUID()}@example.test`
  const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m14-campaign-api`).digest('hex')
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
  const login = await fetch(`${base}/admin/auth/login`, { method: 'POST',
    headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  expect(login.status).toBe(200)
  await connectDatabase()
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await json(login)).csrfToken
  org = (await json(await request('/admin/organizations', 'POST', { name: 'Campanhas API' }))).organization.id
  otherOrg = (await json(await request('/admin/organizations', 'POST', { name: 'Outra API' }))).organization.id
  const connection = (await json(await request(`/admin/organizations/${org}/connections/evolution`, 'POST', { channel: 'baileys' }))).connection
  expect((await request(`/admin/organizations/${org}/connections/active`, 'PUT',
    { provider: 'evolution', connectionId: connection.id, revision: 0 })).status).toBe(200)
  const event = await request(`/admin/organizations/${org}/events`, 'POST', {
    name: 'Festa', location: 'Jardim', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
    endsAt: '2027-01-03T02:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 0, companionNamesRequired: false,
  })
  expect(event.status).toBe(201)
  eventId = (await json(event)).event.id
  const template = `/admin/organizations/${org}/events/${eventId}/template`
  expect((await request(template, 'PUT', defaultTemplate)).status).toBe(200)
  expect((await request(`${template}/publish`, 'POST')).status).toBe(201)
  const guest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST',
    { name: 'Ana', phone: '+5567999999999', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' }))).guest
  const invitation = await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', { guestId: guest.id })
  expect(invitation.status).toBe(201)
  invitationId = (await json(invitation)).invitation.id
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('campanha exige sessão, CSRF, organização e prévia aprovada sem enviar na criação', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/campaigns`
  const body = { invitationIds: [invitationId], intervalMs: 5000 }
  expect((await request(path, 'POST', body, false)).status).toBe(401)
  expect((await request(path, 'POST', body, true, 'wrong')).status).toBe(403)
  expect((await request(path.replace(org, otherOrg), 'POST', body)).status).toBe(404)
  const planned = await request(path, 'POST', body)
  expect(planned.status).toBe(200)
  expect(planned.headers.get('cache-control')).toBe('private, no-store')
  const { campaign, preview } = await json(planned)
  expect(campaign).toMatchObject({ status: 'draft', recipientCount: 1 })
  expect(preview).toMatchObject({ items: [{ invitationId, recipient: { name: 'Ana' } }], previewHash: expect.any(String) })
  expect(await DeliveryModel.countDocuments({ campaignId: campaign.id })).toBe(0)
  const reopened = await request(`${path}/${campaign.id}/preview`)
  expect(reopened.status).toBe(200)
  expect((await json(reopened)).preview.previewHash).toBe(preview.previewHash)
  expect((await request(`${path}/${campaign.id}/approve`, 'POST', { approve: true, previewHash: '0'.repeat(64) })).status).toBe(409)
  expect((await request(`${path}/${campaign.id}/approve`, 'POST', { approve: true, previewHash: preview.previewHash })).status).toBe(200)
  expect(await DeliveryModel.countDocuments({ campaignId: campaign.id })).toBe(1)
  expect((await request(`${path}/${campaign.id}/pause`, 'POST', {})).status).toBe(200)
  expect((await json(await request(`${path}/${campaign.id}`))).campaign.status).toBe('paused')
  expect((await request(`${path}/${campaign.id}/resume`, 'POST', {})).status).toBe(200)
  expect((await json(await request(path))).items).toHaveLength(1)
}, 20_000)

test('API agenda com revisão humana e cancela em rota protegida', async () => {
  const path = `/admin/organizations/${org}/events/${eventId}/campaigns`
  const guest = (await json(await request(`/admin/organizations/${org}/guests`, 'POST',
    { name: 'Beatriz', phone: '+5567999999998', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' }))).guest
  const invitation = await request(`/admin/organizations/${org}/events/${eventId}/invitations`, 'POST', { guestId: guest.id })
  const scheduledInvitationId = (await json(invitation)).invitation.id
  const scheduledAt = new Date(Date.now() + 60 * 60_000).toISOString()
  const planned = await request(path, 'POST', { invitationIds: [scheduledInvitationId], intervalMs: 5000, scheduledAt })
  expect(planned.status).toBe(200)
  const { campaign, preview } = await json(planned)
  expect(campaign).toMatchObject({ status: 'draft', scheduledAt, cancelledAt: null })
  expect(preview).toMatchObject({ scheduledAt })
  expect((await request(`${path}/${campaign.id}/approve`, 'POST',
    { approve: true, previewHash: preview.previewHash })).status).toBe(200)
  expect((await json(await request(`${path}/${campaign.id}`))).campaign.status).toBe('scheduled')
  expect((await request(`${path}/${campaign.id}/cancel`, 'POST', {}, false)).status).toBe(401)
  expect((await request(`${path}/${campaign.id}/cancel`, 'POST', {}, true, 'wrong')).status).toBe(403)
  expect((await request(`${path}/${campaign.id}/cancel`, 'POST', {})).status).toBe(200)
  expect((await json(await request(`${path}/${campaign.id}`))).campaign)
    .toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) })
  expect((await request(`${path}/${campaign.id}/resume`, 'POST', {})).status).toBe(409)
}, 20_000)
