import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'
import { createEvolutionConnection, provisionEvolutionConnection, selectActiveConnection } from '../../packages/core/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm06-delivery-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m06-delivery-e2e`).digest('hex')
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
  process.env.EVOLUTION_MODE = 'fake'
  process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test'
  process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m06-delivery-e2e-key`).digest('base64')
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)

  for (const [app, port, extra] of [
    ['api', process.env.API_PORT!, { EVOLUTION_MODE: 'fake' }],
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

test('revisa conteúdo e aprova somente solicitação fake com consentimento', async ({ page }) => {
  const futureYear = new Date().getFullYear() + 1
  test.setTimeout(60_000)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.locator('#organization-name').fill('Zingara M06 envios')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()

  const organizationId = await page.getByRole('combobox', { name: 'Organização' }).inputValue()
  const created = await createEvolutionConnection(organizationId, { channel: 'baileys' })
  expect(created).toHaveProperty('connection')
  if (!('connection' in created)) throw new Error('Conexão fake não criada')
  expect(await provisionEvolutionConnection(organizationId, created.connection.id)).toHaveProperty('connection')
  expect(await selectActiveConnection(organizationId, created.connection.id, 'evolution')).toHaveProperty('connection')

  await page.getByRole('button', { name: 'Convidados' }).click()
  await page.locator('#guest-name').fill('Ana autorizada')
  await page.locator('#guest-phone').fill('+5567991112233')
  await page.locator('#guest-whatsapp-consent').check()
  await page.locator('#guest-authorization-source').fill('Formulário presencial assinado')
  await page.getByRole('button', { name: 'Criar contato' }).click()
  await expect(page.getByText('Contato criado.')).toBeVisible()

  await page.getByRole('button', { name: 'Eventos' }).click()
  await page.locator('#event-name').fill('Celebração M06 envios')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill(`${futureYear}-11-15T18:00:00-04:00`)
  await page.locator('#event-end').fill(`${futureYear}-11-15T23:00:00-04:00`)
  await page.locator('#event-rsvp').fill(`${futureYear}-11-10T23:59:00-04:00`)
  await page.locator('#event-time-zone').selectOption('America/Campo_Grande')
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  let eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M06 envios' })
  await eventCard.getByRole('button', { name: 'Editar convite' }).click()
  await page.getByLabel('Mensagem WhatsApp do evento').fill('Olá, {{convidado.nome}}. {{evento.nome}} em {{evento.data}} às {{evento.horario}} · {{evento.fuso}}. Prazo: {{evento.prazo_confirmacao}}. {{convite.link}}')
  await page.getByRole('button', { name: 'Publicar convite' }).click()
  await expect(page.getByText(/Convite publicado na versão/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()

  eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M06 envios' })
  await eventCard.getByRole('button', { name: 'Gerenciar convites' }).click()
  await page.getByRole('button', { name: 'Emitir convite' }).click()
  await expect(page.getByText(/Convite pronto para Ana autorizada/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()

  eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M06 envios' })
  await eventCard.getByRole('button', { name: 'Prévia e envios' }).click()
  await expect(page.getByLabel('Link individual do convite')).toHaveCount(0)
  await page.getByRole('button', { name: 'Gerar prévia' }).click()
  await expect(page.getByText('Fake local', { exact: true })).toBeVisible()
  await expect(page.getByText('Consentimento para WhatsApp registrado no contato.')).toBeVisible()
  await expect(page.getByLabel('Texto que será enviado')).not.toHaveValue('')
  await expect(page.getByLabel('Texto que será enviado')).toHaveValue(/^Olá, Ana autorizada\./)
  await expect(page.getByLabel('Texto que será enviado')).toHaveValue(/Horário de Ponta Porã/)
  await expect(page.getByLabel('Texto que será enviado')).toHaveValue(new RegExp(`10 de novembro de ${futureYear}, às 23:59`))
  await expect(page.getByLabel('Texto que será enviado')).not.toHaveValue(/convite\.exemplo|Ana Convidada/)
  await expect(page.getByLabel('Link individual do convite')).toHaveValue(/^https?:\/\//)

  await page.getByLabel(/Aprovo a simulação deste envio/).check()
  await page.getByRole('button', { name: 'Aprovar envio simulado' }).click()
  await expect(page.getByText(/Aprovação simulada registrada/)).toBeVisible()
  await expect(page.locator('.delivery-record').filter({ hasText: 'Ana autorizada' })).toContainText('Planejado')
  await expect(page.getByRole('button', { name: 'Aprovar envio simulado' })).toHaveCount(0)
})
