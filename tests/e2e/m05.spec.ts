import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { expect, test } from '@playwright/test'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
const email = 'm05-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m05-e2e-admin`).digest('hex')
const processes: ChildProcess[] = []
let apiOrigin: string
let inviteOrigin: string
let organizationId: string
let eventId: string
let invitationId: string
let link: string
let cookie: string
let csrf: string
let databaseName = ''

async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => server.close(resolve))
  return address.port
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return }
    catch { /* servidor iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Servidor não iniciou')
}

async function adminRequest(path: string, method: string, body?: unknown) {
  const headers: Record<string, string> = {
    cookie, origin: process.env.ADMIN_ORIGIN!, 'x-csrf-token': csrf,
  }
  const options: RequestInit = { method, headers }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${apiOrigin}${path}`, options)
  expect(response.ok, `Falha em ${method} ${path}: ${response.status}`).toBe(true)
  return response.json() as Promise<any>
}

test.beforeAll(async () => {
  const uri = new URL(process.env.MONGODB_URI!)
  databaseName = `zingara_m05_e2e_${randomUUID().slice(0, 12)}`
  uri.pathname = `/${databaseName}`
  process.env.MONGODB_URI = uri.toString()
  apiOrigin = `http://127.0.0.1:${await freePort()}`
  inviteOrigin = `http://127.0.0.1:${await freePort()}`
  process.env.INVITE_ORIGIN = inviteOrigin
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)
  processes.push(spawn(process.execPath, ['apps/api/.output/server/index.mjs'], {
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: new URL(apiOrigin).port }, stdio: 'ignore',
  }))
  processes.push(spawn(process.execPath, ['apps/invite/.output/server/index.mjs'], {
    cwd: process.cwd(), env: {
      ...process.env, NITRO_PORT: new URL(inviteOrigin).port,
      NUXT_API_INTERNAL_URL: apiOrigin, NUXT_INVITE_ORIGIN: inviteOrigin,
    }, stdio: 'ignore',
  }))
  await waitFor(`${apiOrigin}/health`)
  await waitFor(inviteOrigin)

  const login = await fetch(`${apiOrigin}/admin/auth/login`, {
    method: 'POST', headers: { origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await login.json() as { csrfToken: string }).csrfToken
  organizationId = (await adminRequest('/admin/organizations', 'POST', { name: 'M05 E2E' })).organization.id
  const startsAt = new Date(Date.now() + 30 * 86_400_000)
  const endsAt = new Date(startsAt.getTime() + 5 * 3_600_000)
  const rsvpDeadline = new Date(Date.now() + 20 * 86_400_000)
  eventId = (await adminRequest(`/admin/organizations/${organizationId}/events`, 'POST', {
    name: 'Celebração de teste', location: 'Jardim das Águas', address: 'Rua das Flores, 123',
    startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), rsvpDeadline: rsvpDeadline.toISOString(),
    timeZone: 'America/Campo_Grande', companionLimit: 2, companionNamesRequired: true,
  })).event.id
  const guestId = (await adminRequest(`/admin/organizations/${organizationId}/guests`, 'POST', {
    name: 'Ana <em>convidada</em>', phone: '+5567999991111',
  })).guest.id
  const templatePath = `/admin/organizations/${organizationId}/events/${eventId}/template`
  await adminRequest(templatePath, 'PUT', {
    ...defaultTemplate, title: 'Celebração de teste', subtitle: 'Olá, {{convidado.nome}}',
  })
  await adminRequest(`${templatePath}/publish`, 'POST')
  const issued = await adminRequest(`/admin/organizations/${organizationId}/events/${eventId}/invitations`, 'POST', { guestId })
  invitationId = issued.invitation.id
  link = issued.link
  expect(link).toMatch(new RegExp(`^${inviteOrigin.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')}/i/[A-Za-z0-9_-]{43}$`))
}, 30_000)

test.afterAll(async () => {
  for (const child of processes) child.kill('SIGTERM')
  if (databaseName) {
    const db = await connectDatabase()
    await db.connection.dropDatabase()
    await db.disconnect()
  }
})

test('convidado confirma, resolve conflito, recusa e vê link revogado', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'Celebração de teste' })).toBeVisible()
  await expect(page.getByText('Ana <em>convidada</em>').first()).toBeVisible()
  await expect(page.locator('em')).toHaveCount(0)
  await expect(page.getByText('Aguardando resposta')).toBeVisible()
  await page.screenshot({ path: 'test-results/m09-public-invite-mobile.png', fullPage: true })
  const accept = page.getByRole('radio', { name: 'Sim, confirmo presença' })
  await accept.focus()
  await page.keyboard.press('Space')
  await expect(accept).toBeChecked()
  await page.getByRole('button', { name: 'Adicionar acompanhante' }).click()
  await page.getByRole('textbox', { name: 'Acompanhante 1' }).fill('Bia')
  await page.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText('Presença confirmada para 2 pessoas.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('2 pessoas confirmadas')).toBeVisible()

  const token = new URL(link).pathname.split('/').at(-1)!
  const current = await fetch(`${apiOrigin}/public/invitations/${token}`)
  const version = ((await current.json()) as { invitation: { response: { version: number } } }).invitation.response.version
  const changed = await fetch(`${apiOrigin}/public/invitations/${token}/rsvp`, {
    method: 'PUT', headers: { origin: inviteOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'declined', companions: [], expectedVersion: version }),
  })
  expect(changed.status).toBe(200)
  await page.getByRole('textbox', { name: 'Acompanhante 1' }).fill('Carla')
  await page.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText('Outra resposta foi registrada.')).toBeVisible()
  await page.getByRole('button', { name: 'Recarregar convite' }).click()
  await expect(page.getByText('Presença recusada')).toBeVisible()
  await page.getByRole('radio', { name: 'Sim, confirmo presença' }).check()
  await page.getByRole('button', { name: 'Salvar resposta' }).click()
  await expect(page.getByText('Presença confirmada para 1 pessoa.')).toBeVisible()

  await adminRequest(`/admin/organizations/${organizationId}/events/${eventId}/invitations/${invitationId}/revoke`, 'POST')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Este convite não está disponível' })).toBeVisible()
  await page.goto(`${inviteOrigin}/i/${'x'.repeat(43)}`)
  await expect(page.getByRole('heading', { name: 'Este convite não está disponível' })).toBeVisible()
})
