import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, EvolutionConnectionModel, EvolutionInstallationModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const originalEnvironment = {
  baseUrl: process.env.EVOLUTION_BASE_URL, apiKey: process.env.EVOLUTION_API_KEY,
  mode: process.env.EVOLUTION_MODE, controlEnabled: process.env.EVOLUTION_CONTROL_REAL_ENABLED,
}
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-api`).digest('base64')
process.env.EVOLUTION_BASE_URL = 'https://evolution.m11.test'
process.env.EVOLUTION_API_KEY = 'environment-global-secret'
process.env.EVOLUTION_MODE = 'fake'
const email = 'm11@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-admin`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function request(path: string, method = 'GET', body?: unknown, options: {
  authenticated?: boolean; origin?: string; csrf?: string } = {}) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(options.authenticated === false ? {} : { cookie }),
    ...(method === 'GET' ? {} : { origin: options.origin ?? process.env.ADMIN_ORIGIN!,
      'x-csrf-token': options.csrf ?? csrf }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

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
  const login = await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: {
    origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await login.json() as any).csrfToken
  org = (await (await request('/admin/organizations', 'POST', { name: 'M11' })).json() as any).organization.id
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
  restoreEnvironment('EVOLUTION_BASE_URL', originalEnvironment.baseUrl)
  restoreEnvironment('EVOLUTION_API_KEY', originalEnvironment.apiKey)
  restoreEnvironment('EVOLUTION_MODE', originalEnvironment.mode)
  restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', originalEnvironment.controlEnabled)
}, 20_000)

test('instalação exige sessão, origem e CSRF sem expor a chave', async () => {
  const path = '/admin/evolution/installation'
  expect((await request(path, 'GET', undefined, { authenticated: false })).status).toBe(401)
  const unavailable = await request(path)
  expect(unavailable.status).toBe(502)
  expect(await unavailable.text()).not.toContain(process.env.EVOLUTION_API_KEY)
  const body = { baseUrl: process.env.EVOLUTION_BASE_URL, adminApiKey: 'admin-secret' }
  expect((await request(path, 'PUT', body, { authenticated: false })).status).toBe(405)
  expect((await request(path, 'PUT', body)).status).toBe(405)
  await connectDatabase()
  expect(await EvolutionInstallationModel.findById('global')).toBeNull()
}, 20_000)

test('instalação direta com controle desligado não reserva conexão pela API', async () => {
  const response = await request(`/admin/organizations/${org}/connections/evolution`, 'POST', { channel: 'baileys' })
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain(process.env.EVOLUTION_API_KEY)
  await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ organizationId: org }).select('state')
  expect(connection).toBeNull()
}, 20_000)

test('inventário e vínculo bloqueiam pedidos forjados sem IDs locais', async () => {
  const inventory = `/admin/organizations/${org}/connections/evolution/instances`
  expect((await request(inventory, 'GET', undefined, { authenticated: false })).status).toBe(401)
  expect((await request(inventory)).status).toBe(503)
  const link = `/admin/organizations/${org}/connections/evolution/link`
  const body = { channel: 'baileys', instanceName: 'zingara-external-123456', token: 'instance-token', confirm: true }
  expect((await request(link, 'POST', body, { authenticated: false })).status).toBe(401)
  expect((await request(link, 'POST', body, { csrf: 'wrong' })).status).toBe(403)
  expect((await request(link, 'POST', { ...body, instanceName: 'foreign-app' })).status).toBe(400)
  expect((await request(link, 'POST', body)).status).toBe(400)
  const forged = `/admin/organizations/${org}/connections/evolution/foreign-app`
  expect((await request(`${forged}/status`)).status).toBe(404)
  expect((await request(`${forged}/connect`, 'POST')).status).toBe(404)
  expect((await request(forged, 'DELETE')).status).toBe(404)
})
