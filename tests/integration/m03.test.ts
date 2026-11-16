import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, EventModel, GuestModel, LoginAttemptModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
const email = 'm03@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m03-test-admin`).digest('hex')
let api: ChildProcess
let base: string
let errors = ''
let cookie: string
let csrf: string
let firstOrg: string
let secondOrg: string

async function request(path: string, method = 'GET', body?: unknown, authenticated = true) {
  const options: RequestInit = {
    method,
    headers: {
      ...(authenticated ? { cookie } : {}),
      ...(body === undefined ? {} : { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json', 'x-csrf-token': csrf }),
    },
  }
  if (body !== undefined) options.body = JSON.stringify(body)
  return fetch(`${base}${path}`, options)
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
  for (let attempt = 0; attempt < 150; attempt++) {
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
  const one = await request('/admin/organizations', 'POST', { name: 'M03 um' })
  const two = await request('/admin/organizations', 'POST', { name: 'M03 dois' })
  firstOrg = (await json(one)).organization.id
  secondOrg = (await json(two)).organization.id
  await connectDatabase()
}, 60_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('cadastro manual só registra consentimento com origem e administrador', async () => {
  const organization = await request('/admin/organizations', 'POST', { name: 'M03 consentimento' })
  const path = `/admin/organizations/${(await json(organization)).organization.id}/guests`
  const data = { name: 'Consentimento auditado', phone: '+5567999988888', whatsappConsent: true }
  expect((await request(path, 'POST', data)).status).toBe(400)
  const created = await request(path, 'POST', { ...data, authorizationSource: 'Formulário presencial assinado' })
  expect(created.status).toBe(201)
  const guest = (await json(created)).guest
  const saved = await GuestModel.findById(guest.id)
  expect(saved?.whatsappAuthorization?.source).toBe('Formulário presencial assinado')
  expect(saved?.whatsappAuthorization?.confirmedBy).toBeTruthy()
  expect(saved?.whatsappAuthorization?.confirmedAt).toBeInstanceOf(Date)
  expect((await request(`${path}/${guest.id}`, 'PATCH', { name: 'Nome corrigido', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado' })).status).toBe(200)
  const unchanged = await GuestModel.findById(guest.id)
  expect(unchanged?.whatsappAuthorization?.confirmedBy).toBe(saved?.whatsappAuthorization?.confirmedBy)
  expect(unchanged?.whatsappAuthorization?.confirmedAt).toEqual(saved?.whatsappAuthorization?.confirmedAt)
  expect((await request(`${path}/${guest.id}`, 'PATCH', { whatsappConsent: true })).status).toBe(400)
  expect((await request(`${path}/${guest.id}`, 'PATCH', { whatsappConsent: true,
    authorizationSource: 'Confirmação escrita atualizada' })).status).toBe(200)
})

test('evento valida datas e fuso, persiste UTC e isola organizações', async () => {
  const path = `/admin/organizations/${firstOrg}/events`
  const data = {
    name: 'Casamento', description: 'Cerimônia e recepção', location: 'Espaço Jardim', address: 'Rua das Flores, 100',
    startsAt: '2026-12-20T21:00:00-04:00', endsAt: '2026-12-21T01:00:00-04:00',
    rsvpDeadline: '2026-12-19T23:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 2, companionNamesRequired: true,
  }
  expect((await request(path, 'POST', { ...data, endsAt: '2026-12-20T20:00:00-04:00' })).status).toBe(400)
  expect((await request(path, 'POST', { ...data, rsvpDeadline: data.endsAt })).status).toBe(400)
  expect((await request(path, 'POST', { ...data, timeZone: 'Invalid/Zone' })).status).toBe(400)
  expect((await request(path, 'POST', { ...data, location: '' })).status).toBe(400)
  expect((await request(path, 'POST', { ...data, address: '' })).status).toBe(400)
  expect((await request(path, 'POST', { ...data, state: 'published' })).status).toBe(400)
  const created = await request(path, 'POST', data)
  expect(created.status).toBe(201)
  const event = (await json(created)).event
  expect(event.status).toBe('draft')
  expect(event.startsAt).toBe('2026-12-21T01:00:00.000Z')
  expect(event.timeZone).toBe(data.timeZone)
  expect(event).toMatchObject({ description: data.description, location: data.location, address: data.address })
  expect((await EventModel.findById(event.id)).startsAt.toISOString()).toBe(event.startsAt)
  expect((await request(`/admin/organizations/${secondOrg}/events/${event.id}`)).status).toBe(404)
  expect((await request(`/admin/organizations/${secondOrg}/events/${event.id}`, 'PATCH', { name: 'Ataque' })).status).toBe(404)
  expect((await request(`${path}/${event.id}`, 'PATCH', { endsAt: data.startsAt })).status).toBe(400)
  const edited = await request(`${path}/${event.id}`, 'PATCH', { name: 'Casamento novo', address: 'Rua Nova, 200' })
  expect(edited.status).toBe(200)
  expect((await json(await request(`${path}/${event.id}`))).event).toMatchObject({ name: 'Casamento novo', companionLimit: 2, location: data.location, address: 'Rua Nova, 200' })
  expect((await json(await request(path))).total).toBe(1)
}, 20_000)

test('contato valida entrada, busca e pagina sem cruzar organização', async () => {
  const path = `/admin/organizations/${firstOrg}/guests`
  expect((await request(path, 'POST', { name: 'Ana', phone: '67999999999' })).status).toBe(400)
  expect((await request(path, 'POST', { name: 'Ana', phone: '+12' })).status).toBe(400)
  expect((await request(path, 'POST', { name: 'Ana', phone: '+5567999999999', role: 'admin' })).status).toBe(400)
  const first = await request(path, 'POST', { name: 'Ana', phone: '+5567999999999', tags: ['família'], notes: 'Mesa 2' })
  expect(first.status).toBe(201)
  const guest = (await json(first)).guest
  expect(guest.tags).toEqual(['família'])
  expect((await GuestModel.findById(guest.id)).phone).toBe(guest.phone)
  expect((await request(path, 'POST', { name: 'Beto', phone: '+5567888888888' })).status).toBe(201)
  expect((await request(path, 'POST', { name: 'Carla', phone: '+5567777777777' })).status).toBe(201)
  expect((await json(await request(`${path}?q=Ana&page=1&limit=1`))).items).toHaveLength(1)
  const family = await json(await request(`${path}?tag=fam%C3%ADlia`))
  expect(family.total).toBe(1)
  expect(family.items[0].name).toBe('Ana')
  expect((await json(await request(`${path}?page=2&limit=2`))).items).toHaveLength(1)
  expect((await request(`${path}?limit=999`)).status).toBe(400)
  expect((await request(`/admin/organizations/${secondOrg}/guests/${guest.id}`)).status).toBe(404)
  expect((await request(`/admin/organizations/${secondOrg}/guests/${guest.id}`, 'PATCH', { name: 'Ataque' })).status).toBe(404)
  expect((await request(`${path}/${guest.id}`, 'PATCH', { tags: ['amigos'] })).status).toBe(200)
  expect((await json(await request(`${path}/${guest.id}`))).guest).toMatchObject({ name: 'Ana', tags: ['amigos'] })
  expect((await request(`${path}/${guest.id}`, 'PATCH', { name: 'Ana Silva' })).status).toBe(200)
  expect((await json(await request(`${path}/${guest.id}`))).guest).toMatchObject({ name: 'Ana Silva', tags: ['amigos'], notes: 'Mesa 2' })
}, 20_000)

test('CSV mostra erros e duplicidades; importa somente linhas escolhidas', async () => {
  const path = `/admin/organizations/${firstOrg}/guests`
  const csv = 'name,phone,email,tags,notes\nDora,+5567666666666,dora@example.test,família,VIP\nErro,123,,festa,\nAna Nova,+5567999999999,,família,\nEva,+5567555555555,,amigos,'
  const batchId = randomUUID()
  const before = await GuestModel.countDocuments({ organizationId: firstOrg })
  const preview = await request(`${path}/preview`, 'POST', { csv })
  expect(preview.status).toBe(200)
  const rows = (await json(preview)).rows
  expect(rows.map((row: any) => row.line)).toEqual([2, 3, 4, 5])
  expect(rows[1].errors.length).toBeGreaterThan(0)
  expect(rows[2].duplicates.length).toBeGreaterThan(0)
  expect(await GuestModel.countDocuments({ organizationId: firstOrg })).toBe(before)
  expect((await request(`${path}/import`, 'POST', { csv, acceptedRows: [2] })).status).toBe(400)
  expect((await request(`${path}/import`, 'POST', { csv, acceptedRows: [2, 3, 4], batchId })).status).toBe(400)
  const imported = await request(`${path}/import`, 'POST', { csv, acceptedRows: [2, 4], batchId })
  expect(imported.status).toBe(200)
  const created = (await json(imported)).created
  expect(created).toHaveLength(2)
  expect(await GuestModel.countDocuments({ organizationId: firstOrg })).toBe(before + 2)
  const repeated = await request(`${path}/import`, 'POST', { csv, acceptedRows: [2, 4], batchId })
  expect(repeated.status).toBe(200)
  expect((await json(repeated)).created.map((guest: any) => guest.id)).toEqual(created.map((guest: any) => guest.id))
  expect(await GuestModel.countDocuments({ organizationId: firstOrg })).toBe(before + 2)
  expect((await request(`${path}/preview`, 'POST', { csv: 'name,phone\nA,+5567111111111\n'.repeat(300) })).status).toBe(400)
  expect((await request(`${path}/preview`, 'POST', { csv: 'name,phone\nA,+5567111111111\n'.repeat(1000) })).status).toBe(413)
}, 20_000)

test('CSV aceita linha física acima de 202 e retry após importação parcial', async () => {
  const path = `/admin/organizations/${firstOrg}/guests`
  const csv = `name,phone,notes\n${'\n'.repeat(201)}Longa,+5567444444444,"primeira\nsegunda"\nOutra,+5567333333333,nota`
  const preview = await request(`${path}/preview`, 'POST', { csv })
  expect(preview.status).toBe(200)
  expect((await json(preview)).rows.map((row: any) => row.line)).toEqual([203, 205])
  const batchId = randomUUID()
  const first = await GuestModel.create({ organizationId: firstOrg, name: 'Longa', phone: '+5567444444444', notes: 'primeira\nsegunda', tags: [], importBatchId: batchId, importLine: 203 })
  const before = await GuestModel.countDocuments({ organizationId: firstOrg })
  const imported = await request(`${path}/import`, 'POST', { csv, acceptedRows: [203, 205], batchId })
  expect(imported.status).toBe(200)
  const created = (await json(imported)).created
  expect(created).toHaveLength(2)
  expect(created[0].id).toBe(first.id)
  expect(await GuestModel.countDocuments({ organizationId: firstOrg })).toBe(before + 1)
  const retry = await request(`${path}/import`, 'POST', { csv, acceptedRows: [203, 205], batchId })
  expect((await json(retry)).created.map((guest: any) => guest.id)).toEqual(created.map((guest: any) => guest.id))
  expect(await GuestModel.countDocuments({ organizationId: firstOrg })).toBe(before + 1)
}, 20_000)

test('documentos exigem seleção, deduplicam e vinculam retry ao arquivo e autorização', async () => {
  const path = `/admin/organizations/${secondOrg}/guests`
  const file = { name: 'lista.txt', contentBase64: Buffer.from('Ana;(67) 99999-1111\nDuplicada;+55 67 99999-1111\nInválida;abc').toString('base64') }
  const preview = await request(`${path}/preview`, 'POST', { file })
  expect(preview.status).toBe(200)
  const rows = (await json(preview)).rows
  expect(rows).toHaveLength(3)
  expect(rows[1].duplicates).toHaveLength(1)
  expect(rows[2].errors.length).toBeGreaterThan(0)
  expect(await GuestModel.countDocuments({ organizationId: secondOrg })).toBe(0)
  const batchId = randomUUID()
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [], batchId })).status).toBe(400)
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [3], batchId })).status).toBe(400)
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [1], batchId, whatsappConsent: true })).status).toBe(400)
  const imported = await json(await request(`${path}/import`, 'POST', { file, acceptedRows: [1, 2], batchId }))
  expect(imported.created).toHaveLength(1)
  expect(imported.reused).toHaveLength(1)
  expect(imported.created[0].whatsappConsent).toBe(false)
  const repeat = await json(await request(`${path}/import`, 'POST', { file, acceptedRows: [1, 2], batchId }))
  expect(repeat.created.map((guest: any) => guest.id)).toEqual(imported.created.map((guest: any) => guest.id))
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [1], batchId })).status).toBe(400)
  // Reusing only existing contacts must still bind the batch to its original source.
  const reuseBatch = randomUUID()
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [1], batchId: reuseBatch })).status).toBe(200)
  expect((await request(`${path}/import`, 'POST', { file, acceptedRows: [2], batchId: reuseBatch })).status).toBe(400)
  expect(await GuestModel.countDocuments({ organizationId: secondOrg })).toBe(1)
}, 20_000)

test('DOC e DOCX reais têm prévia; consentimento explícito registra fonte sem alterar duplicados', async () => {
  const path = `/admin/organizations/${secondOrg}/guests`
  for (const extension of ['doc', 'docx']) {
    const file = { name: `lista.${extension}`, contentBase64: (await readFile(`tests/fixtures/contacts/contacts.${extension}`)).toString('base64') }
    const response = await request(`${path}/preview`, 'POST', { file })
    expect(response.status).toBe(200)
    expect((await json(response)).rows).toHaveLength(2)
  }
  const file = { name: 'lista.csv', contentBase64: Buffer.from('Nome;Telefone\nAna;(67) 99999-1111\nBeto;(67) 99999-2222').toString('base64') }
  const imported = await request(`${path}/import`, 'POST', { file, acceptedRows: [2, 3], batchId: randomUUID(), whatsappConsent: true, authorizationSource: 'Formulário presencial em 15/10/2026' })
  expect(imported.status).toBe(200)
  const result = await json(imported)
  expect(result.reused[0].whatsappConsent).toBe(false)
  expect(result.created[0].whatsappConsent).toBe(true)
  const saved = await GuestModel.findById(result.created[0].id)
  expect(saved.whatsappAuthorization.source).toBe('Formulário presencial em 15/10/2026')
  expect(saved.whatsappAuthorization.confirmedBy).toBe('global')
  expect(saved.whatsappAuthorization.confirmedAt).toBeInstanceOf(Date)
  expect((await request(`${path}/preview`, 'POST', { file }, false)).status).toBe(401)
  await LoginAttemptModel.deleteMany({ _id: /^guest-document-preview:/ })
  expect((await request(`${path}/preview`, 'POST', { file: { name: 'bad.doc', contentBase64: Buffer.from('text').toString('base64') } })).status).toBe(400)
}, 20_000)

test('importações documentais concorrentes não criam dois contatos com mesmo telefone', async () => {
  const path = `/admin/organizations/${secondOrg}/guests`
  const file = { name: 'concorrente.txt', contentBase64: Buffer.from('Caio;(67) 99999-3333').toString('base64') }
  const results = await Promise.all([1, 2].map(() => request(`${path}/import`, 'POST', { file, acceptedRows: [1], batchId: randomUUID() })))
  expect(results.map(response => response.status)).toEqual([200, 200])
  expect(await GuestModel.countDocuments({ organizationId: secondOrg, phone: '+5567999993333' })).toBe(1)
}, 20_000)

test('rota documental aceita corpo acima de 16 KiB e mantém Origin, CSRF e limite de transporte', async () => {
  const path = `/admin/organizations/${secondOrg}/guests/preview`
  const text = 'name,phone,notes\n' + Array.from({ length: 200 }, (_, index) => `Contato ${index},+55679999${String(index).padStart(4, '0')},${'nota '.repeat(30)}`).join('\n')
  const file = { name: 'lista.csv', contentBase64: Buffer.from(text).toString('base64') }
  expect(JSON.stringify({ file }).length).toBeGreaterThan(16384)
  const preview = await request(path, 'POST', { file })
  expect(preview.status).toBe(200)
  expect((await json(preview)).rows).toHaveLength(200)
  for (const headers of [
    { origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': 'wrong' },
    { origin: 'https://outside.example.test', 'x-csrf-token': csrf },
  ]) {
    const denied = await fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ file }) })
    expect(denied.status).toBe(403)
  }
  const oversized = { file: { name: 'lista.csv', contentBase64: 'A'.repeat(360449) } }
  expect((await request(path, 'POST', oversized)).status).toBe(413)
}, 20_000)

test('deduplicação documental preserva edição de contatos e libera telefone alterado para nova importação', async () => {
  const path = `/admin/organizations/${secondOrg}/guests`
  const file = { name: 'edicao.txt', contentBase64: Buffer.from('Dora;(67) 99999-4444\nEva;(67) 99999-5555').toString('base64') }
  const original = await json(await request(`${path}/import`, 'POST', { file, acceptedRows: [1, 2], batchId: randomUUID() }))
  const dora = original.created[0]
  expect((await request(`${path}/${dora.id}`, 'PATCH', { phone: '+5567999995555' })).status).toBe(200)
  expect((await request(`${path}/${dora.id}`, 'PATCH', { phone: '+5567999996666' })).status).toBe(200)
  const imported = await json(await request(`${path}/import`, 'POST', { file, acceptedRows: [1], batchId: randomUUID() }))
  expect(imported.created).toHaveLength(1)
  expect(imported.created[0].id).not.toBe(dora.id)
  expect(imported.created[0].phone).toBe('+5567999994444')
}, 20_000)

test('identificadores hexadecimais usam a mesma identidade de organização e lote', async () => {
  const path = `/admin/organizations/${secondOrg}/guests/import`
  const file = { name: 'identidade.txt', contentBase64: Buffer.from('Gil;(67) 99999-7777').toString('base64') }
  const batchId = 'aabbccdd-1122-4334-8a9b-ccddeeff0011'
  const first = await json(await request(path, 'POST', { file, acceptedRows: [1], batchId }))
  const replay = await json(await request(`/admin/organizations/${secondOrg.toUpperCase()}/guests/import`, 'POST', { file, acceptedRows: [1], batchId: batchId.toUpperCase() }))
  expect(replay.created.map((guest: any) => guest.id)).toEqual(first.created.map((guest: any) => guest.id))
}, 20_000)

test('quota DOC/DOCX por admin resiste concorrência entre organizações sem bloquear CSV/TXT', async () => {
  await LoginAttemptModel.deleteMany({ _id: /^guest-document-preview:/ })
  const file = { name: 'lista.DOCX', contentBase64: (await readFile('tests/fixtures/contacts/contacts.docx')).toString('base64') }
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    request(`/admin/organizations/${index % 2 ? firstOrg : secondOrg}/guests/preview`, 'POST', { file })))
  expect(responses.filter(response => response.status === 200)).toHaveLength(2)
  expect(responses.filter(response => response.status === 429)).toHaveLength(6)
  expect((await request(`/admin/organizations/${firstOrg}/guests/import`, 'POST', { file, acceptedRows: [1], batchId: randomUUID() })).status).toBe(429)
  const buckets = await LoginAttemptModel.find({ _id: /^guest-document-preview:/ }).lean()
  expect(buckets).toHaveLength(1)
  expect(buckets[0].count).toBe(2)
  const path = `/admin/organizations/${firstOrg}/guests/preview`
  for (const name of ['lista.csv', 'lista.txt']) {
    expect((await request(path, 'POST', { file: { name, contentBase64: Buffer.from('Nome;Telefone\nAna;67999991111').toString('base64') } })).status).toBe(200)
  }
  expect((await request(path, 'POST', { csv: 'name,phone\nAna,+5567999991111' })).status).toBe(200)
  await LoginAttemptModel.deleteMany({ _id: /^guest-document-preview:/ })
}, 20_000)
