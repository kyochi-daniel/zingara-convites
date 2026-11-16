import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm03-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m03-e2e-admin`).digest('hex')
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

test('gerencia evento, contato e importação CSV pela interface', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.locator('#organization-name').fill('Zingara M03')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await expect(page.locator('.design-sidebar .design-organization-select select')).toHaveValue(/^[a-f\d]{24}$/)

  await page.getByRole('button', { name: 'Início' }).click()
  await expect(page.getByRole('heading', { name: /Olá,/ })).toBeVisible()
  await expect(page.getByText('Ainda não há histórico de confirmações.')).toBeVisible()
  await expect(page.getByText('Publique um evento para acompanhar o RSVP.')).toBeVisible()
  await page.screenshot({ path: 'test-results/m09-dashboard.png', fullPage: true })

  await page.getByRole('button', { name: 'Eventos' }).click()
  await page.locator('#event-name').fill('Celebração de novembro')
  await page.locator('#event-description').fill('Encontro de teste')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill('2026-11-15T18:00:00-04:00')
  await page.locator('#event-end').fill('2026-11-15T23:00:00-04:00')
  await page.locator('#event-rsvp').fill('2026-11-10T23:59:00-04:00')
  const timeZone = page.locator('#event-time-zone')
  await expect(timeZone).toHaveValue('America/Campo_Grande')
  await expect(timeZone.locator('option')).toHaveText(['Ponta Porã', 'Brasília'])
  await timeZone.selectOption('America/Sao_Paulo')
  await expect(timeZone).toHaveValue('America/Sao_Paulo')
  await timeZone.selectOption('America/Campo_Grande')
  await page.locator('#event-companion-limit').fill('2')
  await page.locator('#event-companion-names').check()
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  const eventCard = page.locator('.record-card').filter({ hasText: 'Celebração de novembro' })
  await expect(eventCard).toContainText('Ponta Porã')
  await eventCard.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.locator('#event-location').fill('Jardim atualizado')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.locator('.record-card').filter({ hasText: 'Celebração de novembro' })).toContainText('Jardim atualizado')
  await page.screenshot({ path: 'test-results/m03-events.png', fullPage: true })

  await page.getByRole('button', { name: 'Convidados', exact: true }).click()
  await page.locator('#guest-name').fill('Ana de teste')
  await page.locator('#guest-phone').fill('+5567991112233')
  await page.locator('#guest-email').fill('ana@example.test')
  await page.locator('#guest-tags').fill('família, cerimônia')
  await page.getByRole('button', { name: 'Criar contato' }).click()
  await expect(page.getByText('Contato criado.')).toBeVisible()
  const anaCard = page.locator('.guest-card').filter({ hasText: 'Ana de teste' })
  await expect(anaCard).toBeVisible()
  await anaCard.getByRole('button', { name: 'Editar Ana de teste' }).click()
  await page.locator('#guest-name').fill('Ana atualizada')
  await page.getByRole('button', { name: 'Salvar contato' }).click()
  await expect(page.locator('.guest-card').filter({ hasText: 'Ana atualizada' })).toBeVisible()

  const csv = [
    'name,phone,email,tags,notes',
    'Bia Importada,+5567991112244,bia@example.test,amigos,Convite por CSV',
    'Telefone ruim,123,,festa,',
    'Contato duplicado,+5567991112233,,família,',
  ].join('\n')
  await page.locator('#csv-file').setInputFiles({ name: 'convidados.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const preview = page.getByRole('region', { name: 'Prévia do CSV' })
  await expect(preview).toContainText('Telefone E.164 inválido')
  await expect(preview).toContainText('Telefone já cadastrado')
  const biaRow = preview.locator('.csv-row').filter({ hasText: 'Bia Importada' })
  await biaRow.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Importar selecionados' }).click()
  await expect(page.getByText('1 contatos confirmados na importação.')).toBeVisible()
  await page.getByLabel('Buscar convidados').fill('Bia Importada')
  await page.getByLabel('Buscar convidados').press('Enter')
  await expect(page.locator('.guest-card').filter({ hasText: 'Bia Importada' })).toBeVisible()
  await page.getByRole('button', { name: 'Início' }).click()
  await expect(page.locator('.metric-card').filter({ hasText: 'Contatos cadastrados' })).toContainText('2')
  await page.getByRole('button', { name: 'Convidados', exact: true }).click()
  await page.screenshot({ path: 'test-results/m03-guests.png', fullPage: true })
  await page.setViewportSize({ width: 430, height: 932 })
  await expect(page.locator('.design-bottom-nav')).toBeVisible()
  await page.screenshot({ path: 'test-results/m09-guests-mobile.png', fullPage: true })
  await page.locator('.design-bottom-nav').getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByRole('heading', { name: 'Novo evento' })).toBeVisible()
  await page.screenshot({ path: 'test-results/m09-event-mobile.png', fullPage: true })
})
