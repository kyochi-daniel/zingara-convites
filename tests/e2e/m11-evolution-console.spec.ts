import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect, type Page } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm11-evolution-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-evolution-e2e`).digest('hex')
const processes: ChildProcess[] = []
const baieId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const cloudId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const qr = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='

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

async function loginAndOpenConsole(page: Page) {
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.locator('.design-settings-menu summary')).toBeVisible({ timeout: 15_000 })
  await page.locator('.design-settings-menu summary').click()
  await page.locator('.design-settings-links').getByRole('button', { name: 'Organizações' }).click()
  await page.locator('#organization-name').fill(`Zingara M11 ${randomUUID().slice(0, 8)}`)
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await page.locator('.design-settings-menu summary').click()
  await page.locator('.design-settings-links').getByRole('button', { name: 'WhatsApp' }).click()
  await expect(page.getByRole('heading', { name: 'Instalação Evolution' })).toBeVisible()
}

test('instalação, inventário protegido, Baileys e Cloud API sem envio real', async ({ page }) => {
  test.setTimeout(90_000)
  const installation = { baseUrl: 'https://evolution.example.test', verifiedAt: '2026-10-10T12:00:00.000Z', controlEnabled: true }
  let active: { provider: 'evolution'; channel: 'baileys' | 'cloud'; connectionId: string; revision: number } | null = null
  const own: Array<{ instanceName: string; channel: 'baileys' | 'cloud'; state: string; localState: 'ready'; ownership: 'propria'; connectionId: string }> = []
  const states: Record<string, { state: string; qrCode?: string }> = {}
  const external = ['outro-app-a', 'outro-app-b', 'outro-app-c'].map(instanceName =>
    ({ instanceName, channel: 'baileys', state: 'connected', ownership: 'protegida' }))
  let numberChecks = 0
  let pairingRequests = 0
  let currentQr = qr
  const installationMethods: string[] = []
  let releaseCreation!: () => void
  const creationGate = new Promise<void>(resolve => { releaseCreation = resolve })
  await page.route('**/api/admin/evolution/installation', async route => {
    installationMethods.push(route.request().method())
    await route.fulfill({ json: { installation } })
  })
  await page.route('**/api/admin/organizations/*/connections/active', async route => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { provider: 'evolution'; connectionId: string; revision: number }
      active = { ...body, channel: body.connectionId === baieId ? 'baileys' : 'cloud', revision: body.revision + 1 }
    }
    await route.fulfill({ json: { active } })
  })
  await page.route('**/api/admin/organizations/*/connections/evolution**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const connectionId = path.match(/\/evolution\/([a-f\d]{24})(?:\/|$)/)?.[1]
    if (path.endsWith('/instances')) await route.fulfill({ json: { instances: [...external, ...own] } })
    else if (path.endsWith('/evolution') && request.method() === 'POST') {
      const body = request.postDataJSON() as { channel: 'baileys' | 'cloud'; metaToken?: string; phoneNumberId?: string; businessId?: string }
      if (body.channel === 'cloud') expect(body).toEqual({ channel: 'cloud', metaToken: 'segredo-meta-teste-123', phoneNumberId: '123456789', businessId: '987654321' })
      const connectionId = body.channel === 'baileys' ? baieId : cloudId
      own.push({ instanceName: `zingara-${body.channel}-m11`, channel: body.channel,
        state: body.channel === 'baileys' ? 'disconnected' : 'connected', localState: 'ready', ownership: 'propria', connectionId })
      states[connectionId] = { state: body.channel === 'baileys' ? 'disconnected' : 'connected' }
      if (body.channel === 'baileys') await creationGate
      await route.fulfill({ json: { connection: { id: connectionId } } })
    } else if (path.endsWith('/status')) await route.fulfill({ json: { status: states[connectionId!] } })
    else if (path.endsWith('/connect')) {
      expect(connectionId).toBe(baieId)
      pairingRequests++
      states[connectionId!] = { state: 'connecting', qrCode: currentQr }
      await route.fulfill({ json: { status: states[connectionId!] } })
    } else if (path.endsWith('/number-check')) {
      numberChecks++
      await route.fulfill({ json: { exists: true } })
    } else if (path.endsWith('/templates') && request.method() === 'GET') await route.fulfill({ json: { templates: [
      { type: 'initial', name: 'convite_aprovado', language: 'pt_BR', status: 'approved' },
      { type: 'pending_reminder', name: 'lembrete_aprovado', language: 'pt_BR', status: 'approved' },
    ] } })
    else await route.fulfill({ status: 404, json: {} })
  })

  await loginAndOpenConsole(page)
  await expect(page.getByText('Servidor autenticado')).toBeVisible()
  await expect(page.getByLabel('URL HTTPS da Evolution')).toHaveCount(0)
  await expect(page.getByLabel('Chave administrativa')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Testar e salvar instalação' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar instância' })).toBeEnabled()
  expect(installationMethods).toEqual(['GET'])
  for (const name of external.map(item => item.instanceName)) {
    const card = page.locator('.evolution-console-item').filter({ hasText: name })
    await expect(card.getByText('Protegida')).toBeVisible()
    await expect(card.getByRole('button')).toHaveCount(0)
  }
  await page.screenshot({ path: 'test-results/m11-evolution-inventory-desktop.png' })

  await page.getByRole('button', { name: 'Criar instância' }).click()
  await expect(page.getByRole('button', { name: 'Criando…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verificando…' })).toHaveCount(0)
  releaseCreation()
  const baileys = page.locator('.evolution-console-item').filter({ hasText: 'zingara-baileys-m11' })
  await expect(baileys.getByText('Própria')).toBeVisible()
  await baileys.getByRole('button', { name: 'Iniciar pareamento por QR' }).click()
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveAttribute('src', `data:image/png;base64,${qr}`)
  await expect(baileys.getByRole('button', { name: 'Renovar QR de pareamento' })).toBeEnabled()
  await expect(baileys.getByText('Acompanhamento automático:')).toBeVisible()
  await expect(baileys.getByText('Cada QR tem validade definida pela Evolution', { exact: false })).toBeVisible()
  const desktopViewport = page.viewportSize()!
  await page.setViewportSize({ width: 390, height: 844 })
  await baileys.getByRole('img', { name: 'QR temporário da instância Baileys' }).scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/m14-evolution-pairing-mobile.png' })
  await page.setViewportSize(desktopViewport)
  states[baieId] = { state: 'connecting' }
  await baileys.getByRole('button', { name: 'Atualizar estado' }).click()
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveAttribute('src', `data:image/png;base64,${qr}`)
  currentQr = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveAttribute('src', `data:image/png;base64,${currentQr}`, { timeout: 10_000 })
  expect(pairingRequests).toBeGreaterThan(1)
  await baileys.getByRole('button', { name: 'Parar acompanhamento' }).click()
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveCount(0)
  await baileys.getByRole('button', { name: 'Mostrar ou renovar QR de pareamento' }).click()
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveAttribute('src', `data:image/png;base64,${currentQr}`)
  states[baieId] = { state: 'connected' }
  await expect(baileys.getByRole('button', { name: 'Parar acompanhamento' })).toHaveCount(0, { timeout: 10_000 })
  await expect(baileys.getByRole('img', { name: 'QR temporário da instância Baileys' })).toHaveCount(0)
  await baileys.getByLabel('Consultar número no WhatsApp').fill('+5567999999999')
  await baileys.getByRole('button', { name: 'Consultar número' }).click()
  await expect(page.getByText('Número encontrado no WhatsApp.')).toBeVisible()
  expect(numberChecks).toBe(1)
  await baileys.getByRole('button', { name: 'Tornar ativa' }).click()
  await expect(baileys.getByText('Ativa', { exact: true })).toBeVisible()

  await page.getByRole('combobox', { name: 'Canal da nova instância' }).selectOption('cloud')
  await page.getByLabel('Token Meta').fill('segredo-meta-teste-123')
  await page.getByLabel('Phone Number ID').fill('123456789')
  await page.getByLabel('Business ID').fill('987654321')
  await page.getByRole('button', { name: 'Criar instância' }).click()
  const cloud = page.locator('.evolution-console-item').filter({ hasText: 'zingara-cloud-m11' })
  await expect(cloud.getByText('WhatsApp Cloud API')).toBeVisible()
  await expect(cloud.getByRole('button', { name: 'Iniciar pareamento por QR' })).toHaveCount(0)
  await expect(cloud.getByText('Convite inicial · convite_aprovado')).toBeVisible()
  await expect(cloud.getByText('Lembrete pendente · lembrete_aprovado')).toBeVisible()
  await expect(page.getByLabel('Token Meta')).toHaveValue('')
  expect(await page.locator('body').innerText()).not.toContain('segredo-meta-teste-123')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(cloud).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/m11-evolution-mobile.png' })
})

test('orienta a configuração exclusiva na API quando a instalação está ausente', async ({ page }) => {
  await page.route('**/api/admin/evolution/installation', route => route.fulfill({ json: { installation: null } }))
  await loginAndOpenConsole(page)
  await expect(page.getByText('Configure EVOLUTION_BASE_URL e EVOLUTION_API_KEY somente na API/Dokploy.')).toBeVisible()
  await expect(page.getByLabel('URL HTTPS da Evolution')).toHaveCount(0)
  await expect(page.getByLabel('Chave administrativa')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Criar instância' })).toBeDisabled()
})

test('mantém inventário visível e bloqueia controle real quando a API não o liberou', async ({ page }) => {
  await page.route('**/api/admin/evolution/installation', route => route.fulfill({ json: { installation: {
    baseUrl: 'https://evolution.example.test', verifiedAt: '2026-10-10T12:00:00.000Z', controlEnabled: false,
  } } }))
  await page.route('**/api/admin/organizations/*/connections/evolution/instances', route => route.fulfill({ json: { instances: [
    { instanceName: 'outro-app', channel: 'baileys', state: 'connected', ownership: 'protegida' },
  ] } }))
  await page.route('**/api/admin/organizations/*/connections/active', route => route.fulfill({ json: { active: null } }))
  await loginAndOpenConsole(page)
  await expect(page.getByText('A instalação está conectada. A criação e o pareamento aguardam liberação no servidor.')).toBeVisible()
  await expect(page.locator('.evolution-console-item').filter({ hasText: 'outro-app' }).getByText('Protegida')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Criar instância' })).toBeDisabled()
})

test('erro remoto não exibe credencial nem libera ações externas', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/api/admin/evolution/installation', route => route.fulfill({ json: { installation: { baseUrl: 'https://evolution.example.test', verifiedAt: '2026-10-10T12:00:00.000Z', controlEnabled: true } } }))
  await page.route('**/api/admin/organizations/*/connections/evolution/instances', route => route.fulfill({ status: 502, json: { error: 'segredo-global-teste' } }))
  await page.route('**/api/admin/organizations/*/connections/active', route => route.fulfill({ json: { active: null } }))
  await loginAndOpenConsole(page)
  await expect(page.getByRole('alert')).toContainText('Não foi possível conectar à Evolution')
  await expect(page.getByText('Configure EVOLUTION_BASE_URL e EVOLUTION_API_KEY somente na API/Dokploy.')).toHaveCount(0)
  await expect(page.getByText('Inventário indisponível enquanto a conexão não responde.')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain('segredo-global-teste')
  await expect(page.locator('.evolution-console-item')).toHaveCount(0)
})
