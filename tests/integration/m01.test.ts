import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, OrganizationModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
const adminEmail = 'm01@example.test'
const adminPassword = createHash('sha256').update(`${process.env.JWT_SECRET}:m01-test-admin`).digest('hex')
let api: ChildProcess
let base: string
let apiErrors = ''

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

async function bootstrap() {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: adminEmail, ADMIN_BOOTSTRAP_PASSWORD: adminPassword },
    stdio: 'ignore',
  })
  const [code] = await once(child, 'exit')
  expect(code).toBe(0)
}

async function request(path: string, options: RequestInit = {}) {
  return fetch(`${base}${path}`, options)
}

beforeAll(async () => {
  await bootstrap()
  await bootstrap()
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  api = spawn(process.execPath, ['apps/api/.output/server/index.mjs'], {
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'],
  })
  api.stderr?.on('data', chunk => { apiErrors += String(chunk) })
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await request('/health')).ok) return }
    catch { /* processo ainda inicia */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`API não iniciou: ${apiErrors.slice(0, 1000)}`)
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
})

test('login, organização persistida, CSRF e revogação', async () => {
  expect((await request('/admin/organizations')).status).toBe(401)

  const origin = process.env.ADMIN_ORIGIN!
  expect((await request('/admin/auth/login', {
    method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })).status).toBe(403)
  const badLogin = await request('/admin/auth/login', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: 'errada' }),
  })
  expect(badLogin.status).toBe(401)

  const login = await request('/admin/auth/login', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  expect(login.status).toBe(200)
  const cookie = login.headers.get('set-cookie')!
  expect(cookie).toMatch(/HttpOnly/i)
  expect(cookie).toMatch(/SameSite=Lax/i)
  const sessionCookie = cookie.split(';')[0]
  const { csrfToken } = await login.json() as { csrfToken: string }
  expect(csrfToken).toHaveLength(64)

  const session = await request('/admin/auth/session', { headers: { cookie: sessionCookie } })
  expect(session.status).toBe(200)
  expect((await session.json() as { admin: { email: string } }).admin.email).toBe(adminEmail)

  const orgPath = '/admin/organizations'
  const createHeaders = { cookie: sessionCookie, origin, 'content-type': 'application/json' }
  expect((await request(orgPath, { method: 'POST', headers: createHeaders, body: JSON.stringify({ name: 'Acme' }) })).status).toBe(403)
  expect((await request(orgPath, { method: 'POST', headers: { ...createHeaders, 'x-csrf-token': csrfToken }, body: JSON.stringify({ name: '' }) })).status).toBe(400)
  expect((await request(orgPath, { method: 'POST', headers: { ...createHeaders, 'x-csrf-token': csrfToken }, body: JSON.stringify({ name: 'Acme', isAdmin: true }) })).status).toBe(400)

  const created = await request(orgPath, {
    method: 'POST', headers: { ...createHeaders, 'x-csrf-token': csrfToken }, body: JSON.stringify({ name: 'Acme', visualIdentity: { logoUrl: 'https://example.test/logo.png' } }),
  })
  expect(created.status).toBe(201)
  const { organization } = await created.json() as { organization: { id: string, name: string } }
  expect(organization.name).toBe('Acme')
  const listed = await request(orgPath, { headers: { cookie: sessionCookie } })
  expect((await listed.json() as { items: { id: string }[] }).items.some(item => item.id === organization.id)).toBe(true)

  const updated = await request(`${orgPath}/${organization.id}`, {
    method: 'PATCH', headers: { ...createHeaders, 'x-csrf-token': csrfToken }, body: JSON.stringify({ name: 'Acme Eventos', visualIdentity: { primaryColor: '#112233' } }),
  })
  expect(updated.status).toBe(200)
  const read = await request(`${orgPath}/${organization.id}`, { headers: { cookie: sessionCookie } })
  const stored = (await read.json() as { organization: { name: string, visualIdentity: { logoUrl: string } } }).organization
  expect(stored.name).toBe('Acme Eventos')
  expect(stored.visualIdentity.logoUrl).toBe('https://example.test/logo.png')

  expect((await request('/admin/auth/logout', { method: 'POST', headers: { cookie: sessionCookie, origin } })).status).toBe(403)
  const logout = await request('/admin/auth/logout', { method: 'POST', headers: { cookie: sessionCookie, origin, 'x-csrf-token': csrfToken } })
  expect(logout.status).toBe(204)
  expect((await request('/admin/auth/session', { headers: { cookie: sessionCookie } })).status).toBe(401)
}, 20_000)

test('login limita tentativas por email', async () => {
  const headers = { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json', 'x-client-ip': '192.0.2.1' }
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request('/admin/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: 'ausente@example.test', password: 'errada' }) })
    expect(response.status).toBe(401)
  }
  const limited = await request('/admin/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: 'ausente@example.test', password: 'errada' }) })
  expect(limited.status).toBe(429)
})

test('falhas de uma origem não bloqueiam outra origem', async () => {
  const headers = { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json', 'x-client-ip': '192.0.2.2' }
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request('/admin/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: adminEmail, password: 'errada' }) })
    expect(response.status).toBe(401)
  }
  const valid = await request('/admin/auth/login', {
    method: 'POST',
    headers: { ...headers, 'x-client-ip': '192.0.2.3' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  expect(valid.status).toBe(200)
})

test('listagem não oculta organizações após cem registros', async () => {
  await connectDatabase()
  await OrganizationModel.insertMany(Array.from({ length: 101 }, (_, index) => ({ name: `Organização ${index}` })))
  const response = await request('/admin/auth/login', {
    method: 'POST',
    headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json', 'x-client-ip': '192.0.2.5' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!.split(';')[0]
  const listed = await request('/admin/organizations', { headers: { cookie } })
  expect((await listed.json() as { items: unknown[] }).items).toHaveLength(102)
})

test('emails variados atingem limite do transporte', async () => {
  const headers = { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json', 'x-client-ip': '192.0.2.4' }
  const concurrent = await Promise.all(Array.from({ length: 20 }, (_, attempt) => request('/admin/auth/login', {
    method: 'POST', headers, body: JSON.stringify({ email: `guess${attempt}@example.test`, password: 'errada' }),
  })))
  expect(concurrent.every(response => response.status === 401)).toBe(true)
  for (let attempt = 20; attempt < 60; attempt++) {
    const response = await request('/admin/auth/login', {
      method: 'POST', headers, body: JSON.stringify({ email: `guess${attempt}@example.test`, password: 'errada' }),
    })
    expect(response.status).toBe(401)
  }
  const limited = await request('/admin/auth/login', {
    method: 'POST', headers, body: JSON.stringify({ email: 'guess60@example.test', password: 'errada' }),
  })
  expect(limited.status).toBe(429)
}, 20_000)
