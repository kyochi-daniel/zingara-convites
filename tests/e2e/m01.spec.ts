import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const inviteOrigin = process.env.INVITE_ORIGIN!
const email = 'm01-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m01-e2e-admin`).digest('hex')
const processes: ChildProcess[] = []

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return }
    catch { /* servidor ainda inicia */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Servidor não iniciou: ${url}`)
}

test.beforeAll(async () => {
  const uri = new URL(process.env.MONGODB_URI!)
  testDatabase = `zingara_e2e_${randomUUID().slice(0, 12)}`
  uri.pathname = `/${testDatabase}`
  process.env.MONGODB_URI = uri.toString()
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)

  for (const [app, port, extra] of [
    ['api', process.env.API_PORT!, {}],
    ['admin', process.env.ADMIN_PORT!, { NUXT_API_INTERNAL_URL: process.env.API_INTERNAL_URL!, NUXT_ADMIN_ORIGIN: adminOrigin }],
    ['invite', process.env.INVITE_PORT!, { NUXT_API_INTERNAL_URL: process.env.API_INTERNAL_URL! }],
  ] as const) {
    processes.push(spawn(process.execPath, [`apps/${app}/.output/server/index.mjs`], {
      cwd: process.cwd(), env: { ...process.env, ...extra, NITRO_PORT: port }, stdio: 'ignore',
    }))
  }
  await waitFor(`${process.env.API_INTERNAL_URL}/health`)
  await waitFor(adminOrigin)
  await waitFor(inviteOrigin)
}, 30_000)

test.afterAll(async () => {
  for (const child of processes) child.kill('SIGTERM')
  if (testDatabase) {
    const db = await connectDatabase()
    await db.connection.dropDatabase()
    await db.disconnect()
  }
})

test('login, organização, edição, logout e isolamento do convite', async ({ page, context }) => {
  const oversized = await context.request.post(`${adminOrigin}/api/admin/auth/login`, {
    headers: { origin: adminOrigin, 'content-type': 'application/json' }, data: 'x'.repeat(17_000),
  })
  expect(oversized.status()).toBe(413)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').first().fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.getByLabel('Nome').fill('Acme')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await expect(page.locator('.organization-list strong').getByText('Acme', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Editar' }).click()
  await page.getByLabel('Nome').fill('Acme Eventos')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.locator('.organization-list strong').getByText('Acme Eventos', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/m01-admin.png', fullPage: true })

  const inviteCookies = await context.cookies(inviteOrigin)
  expect(inviteCookies.some(cookie => cookie.name === 'zingara_session')).toBe(false)
  const publicAdmin = await fetch(`${inviteOrigin}/api/admin/organizations`, { signal: AbortSignal.timeout(5000) })
  expect(publicAdmin.status).toBe(404)

  await page.getByLabel('Menu do perfil').first().click()
  await page.getByRole('button', { name: 'Sair' }).first().click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  const revoked = await context.request.get(`${adminOrigin}/api/admin/auth/session`)
  expect(revoked.status()).toBe(401)
})
