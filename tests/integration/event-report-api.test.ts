import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  connectDatabase,
  EventModel,
  GuestModel,
  InvitationModel,
  OrganizationModel,
} from '../../packages/database/src/index.ts'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_event_report_api_${randomUUID().replaceAll('-', '').slice(0, 8)}`
process.env.MONGODB_URI = uri.toString()

let api: ChildProcess
let base: string
let cookie: string
let organizationId: string
let otherOrganizationId: string
let eventId: string

async function request(path: string, options: { authenticated?: boolean; origin?: string } = {}) {
  return fetch(`${base}${path}`, {
    headers: {
      ...(options.authenticated === false ? {} : { cookie }),
      ...(options.origin ? { origin: options.origin } : {}),
    },
  })
}

beforeAll(async () => {
  const email = `event-report-${randomUUID()}@example.test`
  const password = createHash('sha256').update(`${process.env.JWT_SECRET}:event-report-api`).digest('hex')
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password },
    stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)

  await connectDatabase()
  organizationId = (await OrganizationModel.create({ name: 'Relatório API' })).id
  otherOrganizationId = (await OrganizationModel.create({ name: 'Outro escopo' })).id
  const event = await EventModel.create({
    organizationId,
    name: 'Evento privado',
    location: 'Salão',
    address: 'Rua C',
    status: 'published',
    startsAt: new Date('2027-05-02T20:00:00.000Z'),
    endsAt: new Date('2027-05-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-05-01T20:00:00.000Z'),
    timeZone: 'America/Campo_Grande',
    companionLimit: 2,
    companionNamesRequired: true,
  })
  eventId = event.id
  const guest = await GuestModel.create({
    organizationId,
    name: 'Ana',
    phone: '+5567999999999',
    tags: [],
  })
  await InvitationModel.create({
    organizationId,
    eventId,
    guestId: guest._id,
    templateVersion: 1,
    secretHash: 'b'.repeat(64),
    secretCiphertext: 'segredo-que-nao-pode-sair',
    expiresAt: new Date('2027-05-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-05-01T20:00:00.000Z'),
    companionLimit: 2,
    companionNamesRequired: true,
    responseStatus: 'accepted',
    companions: ['Bia'],
  })

  const portServer = createServer()
  portServer.listen(0, '127.0.0.1')
  await once(portServer, 'listening')
  const address = portServer.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => portServer.close(resolve))
  base = `http://127.0.0.1:${address.port}`
  api = spawn(process.execPath, ['apps/api/.output/server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, NITRO_PORT: String(address.port) },
    stdio: 'ignore',
  })
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/health`)).ok) {
        ready = true
        break
      }
    } catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('API não iniciou')
  const login = await fetch(`${base}/admin/auth/login`, {
    method: 'POST',
    headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]!
}, 30_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('GET do relatório exige sessão, rejeita origem inválida e isola evento por organização', async () => {
  const path = `/admin/organizations/${organizationId}/events/${eventId}/report`
  expect((await request(path, { authenticated: false })).status).toBe(401)
  expect((await request(path, { origin: 'https://outside.example.test' })).status).toBe(403)
  expect((await request(path.replace(organizationId, otherOrganizationId))).status).toBe(404)
  expect((await request(`/admin/organizations/${organizationId}/events/${'f'.repeat(24)}/report`)).status).toBe(404)

  const response = await request(path)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  const body = await response.json() as any
  expect(Object.keys(body)).toEqual(['report'])
  expect(body.report).toMatchObject({
    eventId,
    eventName: 'Evento privado',
    messages: { total: 0, accepted: 0, delivered: 0, read: 0, awaitingDelivery: 0, failed: 0 },
    rsvp: { pending: 0, accepted: 1, declined: 0, revoked: 0, peopleConfirmed: 2 },
    confirmed: [{ name: 'Ana', phone: '+5567999999999', peopleCount: 2 }],
  })
  expect(JSON.stringify(body)).not.toContain('segredo-que-nao-pode-sair')
})
