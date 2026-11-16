import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = `m12-assistant-${randomUUID().slice(0, 8)}@example.test`
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m12-assistant-e2e`).digest('hex')
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

test('retoma conversa, envia pedido e abre o console do WhatsApp', async ({ page }) => {
  const initial = [{ role: 'assistant', content: 'Posso criar eventos, convidados e convites.', createdAt: '2026-10-10T12:00:00.000Z' }]
  const secondHistory = [{ role: 'assistant', content: 'Histórico exclusivo da segunda organização.', createdAt: '2026-10-10T12:00:00.000Z' }]
  const longReply = 'Proposta pronta:\nEvento: Reabertura Zingara\nIdentificador: evt_01K7E4GFM9QK0EZTQ9R4MXZ8A0D4C5Y7P8R2S6T1V3W5X7Z9\nConvidados: 12\nConfirme para criar.'
  let firstAssistantPath = ''
  let requests = 0
  let posts = 0
  let release!: () => void
  const responseGate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/admin/organizations/*/assistant', async route => {
    requests++
    const path = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET') {
      if (!firstAssistantPath) firstAssistantPath = path
      await route.fulfill({ json: { messages: path === firstAssistantPath ? initial : secondHistory, pending: null } })
      return
    }
    posts++
    if (posts > 1) {
      await route.fulfill({ status: 503, json: { error: 'provider unavailable' } })
      return
    }
    expect(route.request().postDataJSON()).toEqual({ message: 'Abra a conexão do WhatsApp' })
    expect(route.request().headers()['x-csrf-token']).toBeTruthy()
    await responseGate
    const history = path === firstAssistantPath ? initial : secondHistory
    await route.fulfill({ json: {
      messages: [
        ...history,
        { role: 'user', content: 'Abra a conexão do WhatsApp', createdAt: '2026-10-10T12:01:00.000Z' },
        { role: 'assistant', content: longReply, createdAt: '2026-10-10T12:01:01.000Z' },
      ],
      reply: longReply,
      navigation: { type: 'area', area: 'connection' },
    } })
  })

  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('button', { name: 'Abrir assistente' })).toHaveCount(0)
  await page.locator('#organization-name').fill('Zingara M12')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()

  const trigger = page.getByRole('button', { name: 'Abrir assistente' })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Assistente Zingara' })).toBeVisible()
  await expect(page.getByText('Posso criar eventos, convidados e convites.')).toBeVisible()
  await expect(page.getByLabel('Mensagem para o assistente')).toBeFocused()
  expect(requests).toBe(1)
  await page.screenshot({ path: 'test-results/m12-assistant-desktop.png' })

  await page.getByRole('button', { name: 'Fechar assistente' }).click()
  await expect(trigger).toBeFocused()
  await page.locator('#organization-name').fill('Zingara M12 B')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.locator('.design-sidebar').getByRole('combobox', { name: 'Organização' }).locator('option')).toHaveCount(3)
  await trigger.click()
  expect(requests).toBe(1)
  await page.getByLabel('Mensagem para o assistente').fill('Rascunho privado da primeira organização')
  await page.locator('.design-sidebar').getByRole('combobox', { name: 'Organização' }).selectOption({ label: 'Zingara M12 B' })
  await expect(page.getByText('Histórico exclusivo da segunda organização.')).toBeVisible()
  await expect(page.getByText('Posso criar eventos, convidados e convites.')).toHaveCount(0)
  await expect(page.getByLabel('Mensagem para o assistente')).toHaveValue('')
  expect(requests).toBe(2)
  const input = page.getByLabel('Mensagem para o assistente')
  await input.fill('Abra a conexão do WhatsApp')
  await input.press('Enter')
  await expect(page.getByText('Analisando pedido…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled()
  release()

  await expect(page.getByText(longReply)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Instalação Evolution' })).toBeVisible()
  await expect.poll(() => page.locator('.assistant-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true)
  await expect.poll(() => page.locator('html').evaluate(document => document.scrollWidth <= document.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/m12-assistant-long-desktop.png' })
  expect(requests).toBe(3)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('dialog', { name: 'Assistente Zingara' })).toBeVisible()
  await expect.poll(() => page.locator('.assistant-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true)
  await expect.poll(() => page.locator('html').evaluate(document => document.scrollWidth <= document.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/m12-assistant-mobile.png' })
  await page.getByLabel('Mensagem para o assistente').fill('Tente novamente')
  await page.getByRole('button', { name: 'Enviar mensagem' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('Não foi possível falar com o assistente. Tente novamente.')
  await expect(page.getByLabel('Mensagem para o assistente')).toHaveValue('Tente novamente')
  await expect(page.getByText(longReply)).toBeVisible()
  await page.getByLabel('Mensagem para o assistente').press('Escape')
  await expect(page.getByRole('dialog', { name: 'Assistente Zingara' })).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
