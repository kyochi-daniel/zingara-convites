import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm10-evolution-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m10-evolution-e2e`).digest('hex')
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
  ] as const) {
    processes.push(spawn(process.execPath, [`apps/${app}/.output/server/index.mjs`], {
      cwd: process.cwd(), env: { ...process.env, ...extra, NITRO_PORT: port }, stdio: 'ignore',
    }))
  }
  await waitFor(`${process.env.API_INTERNAL_URL}/health`)
  await waitFor(adminOrigin)
}, 30_000)

test.afterAll(async () => {
  await Promise.all(processes.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }))
  if (testDatabase) {
    const db = await connectDatabase()
    await db.connection.dropDatabase()
    await db.disconnect()
  }
})

test('opera a conexão pela API fake no novo console', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/api/admin/evolution/installation', route => route.fulfill({ json: {
    installation: { baseUrl: 'https://evolution.example.test', verifiedAt: '2026-10-10T12:00:00.000Z' },
  } }))
  await page.route('**/api/admin/organizations/*/connections/evolution/instances', async route => {
    const list = await route.fetch({ url: route.request().url().replace(/\/instances$/, '') })
    const body = await list.json() as { connections: Array<{ id: string; instanceName: string; channel: 'baileys' | 'cloud'; state: string }> }
    await route.fulfill({ json: { instances: body.connections.map(connection => ({
      instanceName: connection.instanceName, channel: connection.channel, state: connection.channel === 'baileys' ? 'disconnected' : 'connected',
      localState: connection.state, ownership: 'propria', connectionId: connection.id,
    })) } })
  })
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()
  await page.locator('.design-settings-menu summary').click()
  await page.locator('.design-settings-links').getByRole('button', { name: 'Organizações' }).click()
  await page.locator('#organization-name').fill(`Evolution integrada ${randomUUID().slice(0, 8)}`)
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await page.locator('.design-settings-menu summary').click()
  await page.locator('.design-settings-links').getByRole('button', { name: 'WhatsApp' }).click()
  await expect(page.getByRole('heading', { name: 'Instalação Evolution' })).toBeVisible()
  await page.getByRole('button', { name: 'Criar instância' }).click()
  const baileys = page.locator('.evolution-console-item').filter({ hasText: /^zingara-/ })
  await expect(baileys).toHaveCount(1)
  await baileys.getByRole('button', { name: 'Iniciar pareamento por QR' }).click()
  await expect(baileys.getByLabel('Conteúdo do QR Baileys')).toHaveValue('fake-qr')
  await baileys.getByRole('button', { name: 'Tornar ativa' }).click()
  await expect(baileys.getByText('Ativa', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Canal da nova instância' }).selectOption('cloud')
  await page.getByLabel('Token Meta').fill('e2e-meta-token-only')
  await page.getByLabel('Phone Number ID').fill('123456789')
  await page.getByLabel('Business ID').fill('987654321')
  await page.getByRole('button', { name: 'Criar instância' }).click()
  await expect(page.locator('.evolution-console-item')).toHaveCount(2)
  await expect(page.getByLabel('Token Meta')).toHaveValue('')
  expect(await page.locator('body').innerText()).not.toContain('e2e-meta-token-only')
  const cloud = page.locator('.evolution-console-item').filter({ hasText: 'WhatsApp Cloud API' })
  await expect(cloud.getByRole('button', { name: 'Iniciar pareamento por QR' })).toHaveCount(0)
  await cloud.getByLabel('Nome do template aprovado pela Meta').fill('convite_aprovado')
  await cloud.getByRole('button', { name: 'Salvar template' }).click()
  await expect(page.getByText('Template salvo. O envio exige aprovação vigente pela Meta.')).toBeVisible()
})
