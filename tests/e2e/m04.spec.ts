import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm04-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m04-e2e-admin`).digest('hex')
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
  for (const child of processes) child.kill('SIGTERM')
  if (testDatabase) {
    const db = await connectDatabase()
    await db.connection.dropDatabase()
    await db.disconnect()
  }
})

test('edita layouts, envia imagem e publica snapshots versionados', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.locator('#organization-name').fill('Zingara M04')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await page.getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByText('O convite começa com o modelo genérico.')).toBeVisible()
  await page.locator('#event-name').fill('Celebração 2027')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill('2027-01-15T18:00')
  await page.locator('#event-end').fill('2027-01-15T22:00')
  await page.locator('#event-rsvp').fill('2027-01-12T20:00')
  await page.locator('#event-time-zone').selectOption('America/Campo_Grande')
  await page.locator('#event-companion-limit').fill('2')
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  await page.locator('.record-card').filter({ hasText: 'Celebração 2027' }).getByRole('button', { name: 'Editar convite' }).click()

  await expect(page.getByRole('heading', { name: 'Personalize o convite' })).toBeVisible()
  await expect(page.locator('#template-page-title')).toHaveText('Celebração 2027')
  await expect(page.locator('.preview-stage .artwork')).toBeVisible()
  await expect(page.getByText('Ana Convidada')).toBeVisible()
  await page.getByLabel('Clássico').check()
  await expect(page.locator('.preview-stage .artwork--classic')).toBeVisible()
  await page.locator('#template-title').fill('Convite para {{evento.nome}}')
  await page.locator('#template-subtitle').fill('Olá, {{convidado.nome}}')
  await page.locator('#template-body').fill('Esperamos você em {{evento.local}}.')
  await page.locator('#template-background').fill('#F4EBDD')
  await page.locator('#template-text-color').fill('#2B2520')
  await page.locator('#template-accent').fill('#92543A')
  await expect(page.getByText('Convite para Celebração 2027')).toBeVisible()
  await expect(page.getByText('Olá, Ana Convidada')).toBeVisible()
  await page.screenshot({ path: 'test-results/m11-template-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/m11-template-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWP4z/D/PwgzwBgAaagL9Si+ZoIAAAAASUVORK5CYII=', 'base64')
  await page.locator('#template-image').setInputFiles({ name: 'flor.png', mimeType: 'image/png', buffer: image })
  await expect(page.getByText('Imagem carregada e pronta para a prévia.')).toBeVisible()
  await expect(page.getByLabel('Descrição acessível da imagem')).toBeVisible()
  await expect(page.getByText('Transcreva o texto essencial da arte para pessoas que usam leitores de tela.')).toBeVisible()
  await expect(page.locator('.preview-stage img.artwork-image')).toHaveAttribute('alt', 'Convite para Celebração 2027')
  await page.getByRole('button', { name: 'Celular' }).click()
  await expect(page.locator('.preview-stage')).toHaveClass(/preview-mobile/)
  await page.getByRole('button', { name: 'Desktop' }).click()

  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByText('Rascunho do convite salvo.')).toBeVisible()
  await page.getByRole('button', { name: 'Publicar convite' }).click()
  await expect(page.getByText('Convite publicado na versão 1. Nenhuma mensagem foi enviada.')).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()
  await expect(page.locator('.record-card').filter({ hasText: 'Celebração 2027' })).toContainText('Publicado · v1')

  await page.locator('.record-card').filter({ hasText: 'Celebração 2027' }).getByRole('button', { name: 'Editar convite' }).click()
  await page.getByRole('button', { name: 'Ver snapshot publicado v1' }).click()
  await expect(page.getByText('Esta versão é somente leitura.')).toBeVisible()
  await expect(page.locator('#template-title')).toHaveValue('Convite para {{evento.nome}}')
  await page.getByRole('button', { name: 'Voltar ao rascunho' }).click()
  await page.locator('#template-title').fill('Uma nova edição de {{evento.nome}}')
  await page.getByRole('button', { name: 'Publicar nova versão' }).click()
  await expect(page.getByText('Convite publicado na versão 2. Nenhuma mensagem foi enviada.')).toBeVisible()
  await page.getByRole('button', { name: 'Ver snapshot publicado v2' }).click()
  await expect(page.locator('#template-title')).toHaveValue('Uma nova edição de {{evento.nome}}')
  await page.getByRole('button', { name: 'Voltar ao rascunho' }).click()
  await page.getByRole('button', { name: 'Ver snapshot publicado v1' }).click()
  await expect(page.locator('#template-title')).toHaveValue('Convite para {{evento.nome}}')
})
