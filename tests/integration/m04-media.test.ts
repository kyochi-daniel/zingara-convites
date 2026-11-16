import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase } from '../../packages/database/src/index'
import { assetBelongsToOrganization } from '../../apps/api/utils/assets'

const require = createRequire(new URL('../../apps/api/package.json', import.meta.url))
const sharp = require('sharp')
loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
const email = 'm04-media@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m04-media-test`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string
let otherOrg: string
let uploadsDir: string
let apiErrors = ''

async function request(path: string, method = 'GET', body?: BodyInit, contentType?: string, auth = true) {
  const headers: Record<string, string> = {
    ...(auth ? { cookie } : {}),
    ...(method === 'GET' ? {} : { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': csrf }),
    ...(contentType ? { 'content-type': contentType } : {}),
  }
  const options: RequestInit = { method, headers }
  if (body) options.body = body
  return fetch(`${base}${path}`, options)
}

beforeAll(async () => {
  uploadsDir = await mkdtemp(join(tmpdir(), 'zingara-m04-media-'))
  process.env.UPLOADS_DIR = uploadsDir
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
  api.stderr?.on('data', chunk => { apiErrors += String(chunk) })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) { ready = true; break } }
    catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error(`API não iniciou: ${apiErrors.slice(0, 1000)}`)
  const login = await fetch(`${base}/admin/auth/login`, {
    method: 'POST', headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await login.json() as { csrfToken: string }).csrfToken
  for (const name of ['Mídia um', 'Mídia dois']) {
    const created = await request('/admin/organizations', 'POST', JSON.stringify({ name }), 'application/json')
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { organization: { id: string } }).organization.id
    if (!org) org = id
    else otherOrg = id
  }
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
  if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true })
})

test('upload normaliza imagem, guarda vínculo e entrega WebP sem metadados', async () => {
  const png = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ff0000' } }).png().toBuffer()
  const path = `/admin/organizations/${org}/assets`
  expect((await request(path, 'POST', png, 'image/png', false)).status).toBe(401)
  const withoutCsrf = await fetch(`${base}${path}`, {
    method: 'POST', headers: { origin: process.env.ADMIN_ORIGIN!, cookie, 'content-type': 'image/png' }, body: png,
  })
  expect(withoutCsrf.status).toBe(403)
  const uploaded = await request(path, 'POST', png, 'image/png')
  expect(uploaded.status).toBe(201)
  const { asset } = await uploaded.json() as { asset: { id: string, url: string } }
  expect(asset.id).toMatch(/^[a-f0-9]{32}$/)
  expect(asset.url).toBe(`/media/${asset.id}`)
  expect(await assetBelongsToOrganization(asset.id, org)).toBe(true)
  expect(await assetBelongsToOrganization(asset.id, org.toUpperCase())).toBe(true)
  expect(await assetBelongsToOrganization(asset.id, otherOrg)).toBe(false)
  const media = await request(asset.url, 'GET', undefined, undefined, false)
  expect(media.status).toBe(200)
  expect(media.headers.get('content-type')).toMatch(/^image\/webp/)
  expect(media.headers.get('x-content-type-options')).toBe('nosniff')
  const bytes = Buffer.from(await media.arrayBuffer())
  expect((await sharp(bytes).metadata()).format).toBe('webp')
  const files = await readdir(join(uploadsDir, asset.id))
  expect(files.sort()).toEqual(['image.webp', 'metadata.json'])
  const metadata = JSON.parse(await readFile(join(uploadsDir, asset.id, 'metadata.json'), 'utf8'))
  expect(metadata.organizationId).toBe(org)
  const webpWithExif = await sharp(png).withExifMerge({ IFD0: { Copyright: 'private-test' } }).webp().toBuffer()
  expect((await sharp(webpWithExif).metadata()).exif).toBeDefined()
  const cleaned = await request(path, 'POST', webpWithExif, 'image/webp')
  expect(cleaned.status).toBe(201)
  const cleanedId = ((await cleaned.json()) as { asset: { id: string } }).asset.id
  const cleanedData = await request(`/media/${cleanedId}`, 'GET', undefined, undefined, false)
  expect((await sharp(Buffer.from(await cleanedData.arrayBuffer())).metadata()).exif).toBeUndefined()
  expect(await assetBelongsToOrganization('../health', org)).toBe(false)
  expect((await request('/media/..%2fhealth', 'GET', undefined, undefined, false)).status).toBe(404)
  expect((await request('/media/not-an-id', 'GET', undefined, undefined, false)).status).toBe(404)
}, 20_000)

test('upload rejeita tipo falso, imagem corrompida, dimensão e corpo excessivos', async () => {
  const path = `/admin/organizations/${org}/assets`
  const before = (await readdir(uploadsDir)).length
  expect((await request(path, 'POST', Buffer.from('não é PNG'), 'image/png')).status).toBe(400)
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000000' } }).png().toBuffer()
  expect((await request(path, 'POST', png, 'image/gif')).status).toBe(415)
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000000' } }).png().toBuffer()
  expect((await request(path, 'POST', tooWide, 'image/png')).status).toBe(400)
  expect((await request(path, 'POST', Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png')).status).toBe(413)
  expect((await readdir(uploadsDir)).length).toBe(before)
}, 20_000)
