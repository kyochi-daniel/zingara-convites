import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, EventModel, TemplateVersionModel } from '../../packages/database/src/index'
import { resolveTemplateText, templateInput } from '../../packages/contracts/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
const email = 'm04@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m04-test-admin`).digest('hex')
let api: ChildProcess
let base: string
let errors = ''
let cookie: string
let csrf: string
let firstOrg: string
let secondOrg: string
let eventId: string
const configuration = {
  layout: 'editorial', title: '{{evento.nome}}', subtitle: 'Olá, {{convidado.nome}}',
  body: 'Esperamos você em {{evento.local}}.', primaryButtonText: 'Confirmar', secondaryButtonText: 'Ver local',
  colors: { background: '#FFFFFF', text: '#112233', accent: '#CC5533' },
  font: 'serif', alignment: 'center', blocks: { date: true, location: true, rsvp: true },
}

async function request(path: string, method = 'GET', body?: unknown, authenticated = true, token = csrf) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(authenticated ? { cookie } : {}),
      ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': token }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
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
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: String(address.port) }, stdio: ['ignore', 'ignore', 'pipe'],
  })
  api.stderr?.on('data', chunk => { errors += String(chunk) })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break } }
    catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error(`API não iniciou: ${errors.slice(0, 1000)}`)
  const login = await fetch(`${base}/admin/auth/login`, {
    method: 'POST', headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await json(login)).csrfToken
  firstOrg = (await json(await request('/admin/organizations', 'POST', { name: 'M04 um' }))).organization.id
  secondOrg = (await json(await request('/admin/organizations', 'POST', { name: 'M04 dois' }))).organization.id
  const event = {
    name: 'Casamento', location: 'Jardim', address: 'Rua A', startsAt: '2027-01-02T20:00:00-04:00',
    endsAt: '2027-01-03T02:00:00-04:00', rsvpDeadline: '2027-01-01T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 2, companionNamesRequired: true,
  }
  eventId = (await json(await request(`/admin/organizations/${firstOrg}/events`, 'POST', event))).event.id
  await connectDatabase()
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('schema estrito e substituição de texto segura', () => {
  expect(templateInput.safeParse(configuration).success).toBe(true)
  expect(templateInput.safeParse({ ...configuration, javascript: 'alert(1)' }).success).toBe(false)
  expect(templateInput.safeParse({ ...configuration, layout: 'custom' }).success).toBe(false)
  expect(templateInput.safeParse({ ...configuration, title: '{{evento.segredo}}' }).success).toBe(false)
  expect(templateInput.safeParse({ ...configuration, title: '<script>alert(1)</script>' }).success).toBe(false)
  expect(resolveTemplateText('Olá {{convidado.nome}} e {{evento.local}}', { 'convidado.nome': 'Ana', 'evento.local': 'Jardim' })).toBe('Olá Ana e Jardim')
})

test('rascunho exige sessão e CSRF, valida campos e isola organização', async () => {
  const path = `/admin/organizations/${firstOrg}/events/${eventId}/template`
  expect((await request(`${path}/publish`, 'POST')).status).toBe(400)
  expect((await request(path, 'PUT', configuration, false)).status).toBe(401)
  expect((await request(path, 'PUT', configuration, true, '')).status).toBe(403)
  expect((await request(path, 'PUT', { ...configuration, title: '{{evento.desconhecido}}' })).status).toBe(400)
  expect((await request(path, 'PUT', { ...configuration, html: '<b>x</b>' })).status).toBe(400)
  expect((await request(path, 'PUT', { ...configuration, imageAssetId: '4f4e6d03a9b8521c85c160a60c128be1' })).status).toBe(400)
  expect((await request(path, 'PUT', configuration)).status).toBe(200)
  expect((await json(await request(path))).template).toEqual(configuration)
  expect((await request(`/admin/organizations/${secondOrg}/events/${eventId}/template`)).status).toBe(404)
  expect((await request(`/admin/organizations/${secondOrg}/events/${eventId}/template`, 'PUT', configuration)).status).toBe(404)
  expect((await json(await request(path))).template).toEqual(configuration)
}, 20_000)

test('versões preservam snapshot e evento aponta à última publicação', async () => {
  const path = `/admin/organizations/${firstOrg}/events/${eventId}/template`
  expect((await request(`${path}/publish`, 'POST', undefined, false)).status).toBe(401)
  expect((await request(`${path}/publish`, 'POST', undefined, true, '')).status).toBe(403)
  const first = await request(`${path}/publish`, 'POST')
  expect(first.status).toBe(201)
  expect((await json(first)).publication).toMatchObject({ version: 1, template: configuration })
  expect((await EventModel.findById(eventId)).status).toBe('published')
  expect((await EventModel.findById(eventId)).publishedTemplateVersion).toBe(1)
  const changed = { ...configuration, title: 'Novo título' }
  expect((await request(path, 'PUT', changed)).status).toBe(200)
  const second = await request(`${path}/publish`, 'POST')
  expect(second.status).toBe(201)
  expect((await json(second)).publication).toMatchObject({ version: 2, template: changed })
  expect((await json(await request(`${path}/versions/1`))).publication).toMatchObject({ version: 1, template: configuration })
  expect((await json(await request(`${path}/versions/2`))).publication).toMatchObject({ version: 2, template: changed })
  expect((await request(`/admin/organizations/${secondOrg}/events/${eventId}/template/versions/1`)).status).toBe(404)
  expect(await TemplateVersionModel.countDocuments({ eventId })).toBe(2)
}, 20_000)

test('retry conclui versão gravada antes de uma queda do processo', async () => {
  const event = await EventModel.findById(eventId)
  const version = event.publishedTemplateVersion + 1
  await TemplateVersionModel.create({
    organizationId: firstOrg, eventId, version, sourceDraftRevision: event.templateDraftRevision,
    sourceEventUpdatedAt: event.updatedAt, template: event.templateDraft, event: { name: event.name },
  })
  expect((await request(`/admin/organizations/${firstOrg}/events/${eventId}/template/versions/${version}`)).status).toBe(404)
  const response = await request(`/admin/organizations/${firstOrg}/events/${eventId}/template/publish`, 'POST')
  expect(response.status).toBe(201)
  expect((await json(response)).publication.version).toBe(version)
  expect((await EventModel.findById(eventId)).publishedTemplateVersion).toBe(version)
  expect(await TemplateVersionModel.countDocuments({ eventId, version })).toBe(1)
}, 20_000)

test('snapshot órfão de rascunho antigo não bloqueia publicação nova', async () => {
  const event = await EventModel.findById(eventId)
  const version = event.publishedTemplateVersion + 1
  await TemplateVersionModel.create({
    organizationId: firstOrg, eventId, version, sourceDraftRevision: event.templateDraftRevision - 1,
    sourceEventUpdatedAt: event.updatedAt, template: configuration, event: { name: event.name },
  })
  const path = `/admin/organizations/${firstOrg}/events/${eventId}/template/publish`
  expect((await request(path, 'POST')).status).toBe(409)
  expect(await TemplateVersionModel.countDocuments({ eventId, version })).toBe(0)
  const retry = await request(path, 'POST')
  expect(retry.status).toBe(201)
  expect((await json(retry)).publication.version).toBe(version)
}, 20_000)

test('publicações simultâneas não repetem versão', async () => {
  const path = `/admin/organizations/${firstOrg}/events/${eventId}/template/publish`
  const results = await Promise.all([request(path, 'POST'), request(path, 'POST')])
  expect(results.map(result => result.status).every(status => status === 201 || status === 409)).toBe(true)
  const versions = (await TemplateVersionModel.find({ eventId }).sort({ version: 1 })).map(doc => doc.version)
  expect(new Set(versions).size).toBe(versions.length)
  expect((await EventModel.findById(eventId)).publishedTemplateVersion).toBe(Math.max(...versions))
}, 20_000)
