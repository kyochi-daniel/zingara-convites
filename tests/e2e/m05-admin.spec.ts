import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = 'm05-admin-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m05-admin-e2e`).digest('hex')
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

test('emite, revela, renova e revoga convite no painel', async ({ page }) => {
  test.setTimeout(60_000)
  const futureYear = new Date().getFullYear() + 1
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  await page.locator('#organization-name').fill('Zingara M05')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()
  await page.getByRole('button', { name: 'Convidados' }).click()
  await page.locator('#guest-name').fill('Ana de teste M05')
  await page.locator('#guest-phone').fill('+5567991112233')
  await page.getByRole('button', { name: 'Criar contato' }).click()
  await expect(page.getByText('Contato criado.')).toBeVisible()

  await page.getByRole('button', { name: 'Eventos' }).click()
  await page.locator('#event-name').fill('Celebração M05')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill(`${futureYear}-11-15T18:00:00-04:00`)
  await page.locator('#event-end').fill(`${futureYear}-11-15T23:00:00-04:00`)
  await page.locator('#event-rsvp').fill(`${futureYear}-11-10T23:59:00-04:00`)
  await page.locator('#event-time-zone').selectOption('America/Campo_Grande')
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  const eventCard = page.locator('.record-card').filter({ hasText: 'Celebração M05' })
  await eventCard.getByRole('button', { name: 'Editar convite' }).click()
  await page.getByRole('button', { name: 'Publicar convite' }).click()
  await expect(page.getByText(/Convite publicado na versão/)).toBeVisible()
  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()

  const publishedEvent = page.locator('.record-card').filter({ hasText: 'Celebração M05' })
  await publishedEvent.getByRole('button', { name: 'Gerenciar convites' }).click()
  await page.getByLabel('Convidado').selectOption({ label: 'Ana de teste M05 · +5567991112233' })
  await expect(page.getByText('Prévia do destinatário')).toBeVisible()
  await page.getByRole('button', { name: 'Emitir convite' }).click()
  await expect(page.getByText(/Convite pronto para Ana de teste M05/)).toBeVisible()

  const invitation = page.locator('.invitation-record').filter({ hasText: 'Ana de teste M05' })
  await expect(invitation).toContainText('Pendente')
  await expect(invitation.getByText('Prazo de resposta', { exact: true })).toBeVisible()
  await expect(invitation.getByText('Validade do link', { exact: true })).toBeVisible()
  await expect(invitation.getByText('Prazo', { exact: true })).toHaveCount(0)
  await expect(invitation.locator('.invitation-meta')).toContainText(`10/11/${futureYear}, 23:59:00 · Horário de Ponta Porã`)
  await expect(invitation.locator('.invitation-meta')).toContainText(`15/11/${futureYear}, 23:00:00 · Horário de Ponta Porã`)
  await expect(invitation.getByLabel('Link ativo')).toHaveCount(0)
  await invitation.getByRole('button', { name: 'Revelar link' }).click()
  const revealed = invitation.getByLabel('Link ativo')
  await expect(revealed).toHaveValue(/^https?:\/\//)
  await invitation.getByRole('button', { name: 'Renovar link' }).click()
  await invitation.getByRole('button', { name: 'Confirmar renovação' }).click()
  await expect(page.getByText(/Link renovado/)).toBeVisible()
  await expect(invitation.getByLabel('Link ativo')).toHaveCount(0)
  await invitation.getByRole('button', { name: 'Revogar' }).click()
  await invitation.getByRole('button', { name: 'Confirmar revogação' }).click()
  await expect(invitation).toContainText('Revogado')
})
