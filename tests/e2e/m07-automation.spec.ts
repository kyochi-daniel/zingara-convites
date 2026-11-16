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
const email = 'm07-automation-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m07-automation-e2e`).digest('hex')
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
  process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m07-automation-e2e-key`).digest('base64')
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

test('configura, revisa, ativa e suprime automação em modo fake', async ({ page }) => {
  const futureYear = new Date().getFullYear() + 1
  test.setTimeout(60_000)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.locator('#organization-name').fill('Zingara M07 automações')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()

  const organizationId = await page.getByRole('combobox', { name: 'Organização' }).inputValue()
  const created = await createEvolutionConnection(organizationId, { channel: 'baileys' })
  expect(created).toHaveProperty('connection')
  if (!('connection' in created)) throw new Error('Conexão fake não criada')
  expect(await provisionEvolutionConnection(organizationId, created.connection.id)).toHaveProperty('connection')
  expect(await selectActiveConnection(organizationId, created.connection.id, 'evolution')).toHaveProperty('connection')

  await page.getByRole('button', { name: 'Convidados' }).click()
  await page.locator('#guest-name').fill('Ana automação')
  await page.locator('#guest-phone').fill('+5567991112233')
  await page.locator('#guest-whatsapp-consent').check()
  await page.locator('#guest-authorization-source').fill('Formulário presencial assinado')
  await page.getByRole('button', { name: 'Criar contato' }).click()
  await expect(page.getByText('Contato criado.')).toBeVisible()

  await page.getByRole('button', { name: 'Eventos', exact: true }).click()
  await page.locator('#event-name').fill('Celebração M07 automações')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill(`${futureYear}-11-15T18:00:00-04:00`)
  await page.locator('#event-end').fill(`${futureYear}-11-15T23:00:00-04:00`)
  await page.locator('#event-rsvp').fill(`${futureYear}-11-10T23:59:00-04:00`)
  await page.locator('#event-time-zone').selectOption('America/Campo_Grande')
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  let eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M07 automações' })
  await eventCard.getByRole('button', { name: 'Editar convite' }).click()
  await page.getByRole('button', { name: 'Publicar convite' }).click()
  await expect(page.getByText(/Convite publicado na versão/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()
  eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M07 automações' })
  await eventCard.getByRole('button', { name: 'Gerenciar convites' }).click()
  await page.getByRole('button', { name: 'Emitir convite' }).click()
  await expect(page.getByText(/Convite pronto para Ana automação/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()

  eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M07 automações' })
  await eventCard.getByRole('button', { name: 'Automações' }).click()
  await expect(page.getByText(/Modo fake local/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Automações · Celebração M07 automações/ })).toBeVisible()
  await page.locator('#automation-anchor').selectOption('fixed')
  await expect(page.getByText('Use ISO 8601 com offset explícito. Fuso do evento: Horário de Ponta Porã.')).toBeVisible()
  await expect(page.getByText(/America\/Campo_Grande/)).toHaveCount(0)
  await page.locator('#automation-anchor').selectOption('rsvp_deadline')
  await page.locator('#automation-enabled').check()
  await page.locator('#automation-offset').fill('-60')
  await page.locator('#automation-max').fill('2')
  await page.locator('#automation-grace').fill('120')
  await page.locator('#automation-text').fill('Olá, {{convidado.nome}}. Sobre {{evento.nome}}: {{convite.link}}')
  await page.getByRole('button', { name: 'Salvar regra' }).click()
  await expect(page.getByText(/Regra salva como rascunho/)).toBeVisible()
  await page.getByRole('button', { name: 'Gerar prévia de destinatários' }).click()
  await expect(page.getByRole('heading', { name: 'Prévia de destinatários' })).toBeVisible()
  await expect(page.getByText('1 elegíveis')).toBeVisible()
  await expect(page.getByText('Ana automação', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ativar regra e planejar tarefas' }).click()
  await expect(page.getByText(/Regra ativada\. 1 tarefa\(s\) planejada\(s\)/)).toBeVisible()

  await page.locator('#automation-guest-search').fill('Ana automação')
  await page.getByRole('button', { name: 'Buscar', exact: true }).last().click()
  await page.locator('#automation-guest').selectOption({ label: 'Ana automação · +5567991112233' })
  await page.locator('#automation-suppression-reason').fill('Solicitação explícita de teste')
  await page.locator('#automation-suppression-confirm').check()
  await page.getByRole('button', { name: 'Registrar supressão manual' }).click()
  await expect(page.getByText(/Supressão registrada para Ana automação/)).toBeVisible()
  await expect(page.locator('.automation-job').filter({ hasText: 'Ana automação' })).toContainText('Planejado')

  await page.getByRole('button', { name: 'Eventos', exact: true }).click()
  eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M07 automações' })
  await eventCard.getByRole('button', { name: 'Revisar evento e avisar' }).click()
  await expect(eventCard.getByText('Digite hora local ou ISO com offset. Fuso atual: Horário de Ponta Porã.')).toBeVisible()
  await eventCard.getByLabel('Local', { exact: true }).fill('Jardim revisado')
  await eventCard.getByLabel('Prazo para confirmar presença', { exact: true }).fill(`${futureYear}-11-12T16:00`)
  await eventCard.getByRole('button', { name: 'Salvar revisão e avisar' }).click()
  await expect(eventCard.getByText('Evento revisado. A nova versão pode planejar avisos conforme as regras ativas.')).toBeVisible()
  await expect(eventCard).toContainText('Jardim revisado')
  await eventCard.getByRole('button', { name: 'Revisar evento e avisar' }).click()
  await expect(eventCard.getByLabel('Prazo para confirmar presença', { exact: true })).toHaveValue(`${futureYear}-11-12T16:00`)
  await eventCard.getByRole('button', { name: 'Fechar' }).click()
  await eventCard.getByRole('button', { name: 'Cancelar evento' }).click()
  await eventCard.getByLabel(/Confirmo cancelar/).check()
  await eventCard.getByRole('button', { name: 'Confirmar cancelamento' }).click()
  await expect(eventCard).toContainText('Cancelado')
  await expect(eventCard.getByText(/Evento cancelado\. As regras e tarefas dependentes/)).toBeVisible()
})
