import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { expect, test } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
const previousEnvironment = {
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_ORIGIN: process.env.ADMIN_ORIGIN,
  INVITE_ORIGIN: process.env.INVITE_ORIGIN,
}
const email = 'm11-template-e2e@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-template-e2e-admin`).digest('hex')
const processes: ChildProcess[] = []
let databaseName = ''
let adminOrigin = ''
let apiOrigin = ''
let inviteOrigin = ''

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
  throw new Error(`Servidor não iniciou: ${url}`)
}

test.beforeAll(async () => {
  const uri = new URL(process.env.MONGODB_URI!)
  databaseName = `zingara_m11_template_${randomUUID().slice(0, 12)}`
  uri.pathname = `/${databaseName}`
  process.env.MONGODB_URI = uri.toString()
  apiOrigin = `http://127.0.0.1:${await freePort()}`
  adminOrigin = `http://127.0.0.1:${await freePort()}`
  inviteOrigin = `http://127.0.0.1:${await freePort()}`
  process.env.ADMIN_ORIGIN = adminOrigin
  process.env.INVITE_ORIGIN = inviteOrigin

  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)
  for (const [app, origin, extra] of [
    ['api', apiOrigin, {}],
    ['admin', adminOrigin, { NUXT_API_INTERNAL_URL: apiOrigin, NUXT_ADMIN_ORIGIN: adminOrigin }],
    ['invite', inviteOrigin, { NUXT_API_INTERNAL_URL: apiOrigin, NUXT_INVITE_ORIGIN: inviteOrigin }],
  ] as const) {
    processes.push(spawn(process.execPath, [`apps/${app}/.output/server/index.mjs`], {
      cwd: process.cwd(), env: { ...process.env, ...extra, NITRO_PORT: new URL(origin).port }, stdio: 'ignore',
    }))
  }
  await waitFor(`${apiOrigin}/health`)
  await waitFor(adminOrigin)
  await waitFor(inviteOrigin)
}, 30_000)

test.afterAll(async () => {
  for (const child of processes) child.kill('SIGTERM')
  try {
    if (databaseName) {
      const db = await connectDatabase()
      await db.connection.dropDatabase()
      await db.disconnect()
    }
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('modelo genérico, convite público, cards e CSV no desktop e celular', async ({ page, context }) => {
  test.setTimeout(90_000)
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await page.locator('#organization-name').fill('Zingara M11 Template')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(page.getByText('Organização criada.')).toBeVisible()

  await page.getByRole('button', { name: 'Eventos' }).click()
  await expect(page.getByText('O convite começa com o modelo genérico.')).toBeVisible()
  await expect(page.locator('#event-time-zone')).toHaveValue('America/Campo_Grande')
  await page.locator('#event-name').fill('Celebração M11')
  await page.locator('#event-location').fill('Jardim das Águas')
  await page.locator('#event-address').fill('Rua das Flores, 123')
  await page.locator('#event-start').fill('2027-01-15T18:00')
  await page.locator('#event-end').fill('2027-01-15T22:00')
  await page.locator('#event-rsvp').fill('2027-01-12T20:00')
  await page.getByRole('button', { name: 'Criar evento' }).click()
  await expect(page.getByText('Evento criado como rascunho.')).toBeVisible()
  const card = page.locator('.design-event-card').filter({ hasText: 'Celebração M11' })
  const actions = card.getByRole('group', { name: 'Ações de Celebração M11' })
  const editAction = actions.getByRole('button', { name: 'Editar', exact: true })
  await expect(editAction.locator('svg')).toBeVisible()
  await expect(editAction).toHaveText('')
  await editAction.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(editAction).toBeFocused()
  expect(await editAction.evaluate(node => getComputedStyle(node, '::after').visibility)).toBe('visible')
  expect(await actions.evaluate(node => {
    const buttons = [...node.querySelectorAll('button')]
    return buttons.every((button, index) => buttons.slice(index + 1).every(other => {
      const a = button.getBoundingClientRect()
      const b = other.getBoundingClientRect()
      return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
    }))
  })).toBe(true)
  await page.locator('h2#events-title').click()
  await expect(actions.getByRole('button', { name: 'Gerenciar convites' })).toBeDisabled()
  await expect(card).toContainText('Rascunho')
  await expect(card).toContainText('Ponta Porã')
  await card.screenshot({ path: 'test-results/m11-event-card-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(card).toBeVisible()
  await expect(editAction).toBeVisible()
  expect(await actions.evaluate(node => [...node.querySelectorAll('button')].every(button => {
    const { width, height } = button.getBoundingClientRect()
    return width >= 44 && height >= 44
  }))).toBe(true)
  await card.getByText('Ver nomes das ações').click()
  await expect(card.getByText('Gerenciar convites', { exact: true })).toBeVisible()
  await card.evaluate(node => node.scrollIntoView({ block: 'start' }))
  await card.screenshot({ path: 'test-results/m11-event-card-mobile.png' })
  await page.setViewportSize({ width: 1280, height: 800 })

  await actions.getByRole('button', { name: 'Editar convite' }).click()
  await expect(page.locator('#template-title')).toHaveValue('{{evento.nome}}')
  const preview = page.locator('.preview-stage .artwork')
  await expect(preview.locator('h1')).toHaveText('Celebração M11')
  await expect(preview).toHaveClass(/artwork--editorial/)
  await expect(page.getByLabel('Mensagem WhatsApp do evento')).not.toHaveValue('')
  await page.getByLabel('Mensagem WhatsApp do evento').fill('Mensagem V1: {{convidado.nome}} · {{evento.fuso}} · até {{evento.prazo_confirmacao}} · {{convite.link}}')
  await expect(page.getByLabel('Prévia da mensagem WhatsApp')).toHaveValue('Mensagem V1: Ana Convidada · Horário de Ponta Porã · até 12 de janeiro de 2027, às 20:00 · https://convite.exemplo/ana')
  await page.getByRole('region', { name: 'Mensagem WhatsApp', exact: true }).screenshot({ path: 'test-results/m14-message-editor-desktop.png' })
  await page.locator('#template-title').fill('Convite para {{evento.nome}}')
  await expect(preview.locator('h1')).toHaveText('Convite para Celebração M11')
  await preview.screenshot({ path: 'test-results/m11-template-preview-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(preview).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('region', { name: 'Mensagem WhatsApp', exact: true }).screenshot({ path: 'test-results/m14-message-editor-mobile.png' })
  await preview.evaluate(node => node.scrollIntoView({ block: 'start' }))
  await preview.screenshot({ path: 'test-results/m11-template-preview-mobile.png' })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Publicar convite' }).click()
  await expect(page.getByText('Convite publicado na versão 1. Nenhuma mensagem foi enviada.')).toBeVisible()
  await page.locator('#template-title').fill('Rascunho novo de {{evento.nome}}')
  await page.getByLabel('Mensagem WhatsApp do evento').fill('Mensagem V2: {{convite.link}}')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await page.getByRole('button', { name: 'Ver snapshot publicado v1' }).click()
  await expect(page.locator('#template-title')).toHaveValue('Convite para {{evento.nome}}')
  await expect(preview.locator('h1')).toHaveText('Convite para Celebração M11')
  await expect(page.getByLabel('Mensagem WhatsApp do evento')).toHaveValue(/^Mensagem V1:/)
  await expect(page.getByLabel('Mensagem WhatsApp do evento')).toBeDisabled()
  await expect(page.getByLabel('Prévia da mensagem WhatsApp')).toHaveValue(/^Mensagem V1:/)
  await expect(page.getByText('Esta versão é somente leitura.')).toBeVisible()
  const previewDate = await preview.locator('.artwork-facts strong').first().textContent()
  const previewDeadline = await preview.locator('.artwork-deadline').textContent()

  await page.getByRole('button', { name: 'Voltar aos eventos' }).click()
  await expect(card).toContainText('Publicado · v1')
  await expect(actions.getByRole('button', { name: 'Gerenciar convites' })).toBeEnabled()
  await expect(actions.getByRole('button', { name: 'Cancelar evento' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await card.evaluate(node => node.scrollIntoView({ block: 'start' }))
  const cancelInset = await actions.evaluate(node => {
    const toolbar = node.getBoundingClientRect()
    const cancel = node.querySelector<HTMLButtonElement>('button[aria-label="Cancelar evento"]')!.getBoundingClientRect()
    return toolbar.right - cancel.right
  })
  expect(cancelInset).toBeLessThan(5)
  await card.screenshot({ path: 'test-results/m11-event-card-published-mobile.png' })
  await actions.getByRole('button', { name: 'Cancelar evento' }).click()
  await expect(card.getByRole('heading', { name: 'Confirmar cancelamento' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Confirmar cancelamento' })).toBeDisabled()
  await card.getByRole('button', { name: 'Voltar' }).click()
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.getByRole('button', { name: 'Convidados', exact: true }).click()
  const importPanel = page.locator('.design-csv-import')
  await expect(importPanel).toBeVisible()
  expect(await importPanel.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(320)
  await importPanel.screenshot({ path: 'test-results/m11-csv-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(importPanel).toBeVisible()
  expect(await importPanel.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(380)
  await importPanel.screenshot({ path: 'test-results/m11-csv-mobile.png' })
  await page.setViewportSize({ width: 1280, height: 800 })
  const csv = ['name,phone,email,tags,notes', 'Ana Convidada,+5567991112244,ana@example.test,amigos,'].join('\n')
  await page.locator('#csv-file').setInputFiles({ name: 'm11.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const csvPreview = page.getByRole('region', { name: 'Prévia do CSV' })
  await expect(csvPreview).toContainText('Ana Convidada')
  await csvPreview.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: 'Importar selecionados' }).click()
  await expect(page.getByText('1 contatos confirmados na importação.')).toBeVisible()

  await page.getByRole('button', { name: 'Eventos' }).click()
  await actions.getByRole('button', { name: 'Gerenciar convites' }).click()
  await expect(page.locator('#invitation-guest')).toContainText('Ana Convidada')
  await page.locator('#invitation-guest').selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Emitir convite' }).click()
  await expect(page.getByText('Convite pronto para Ana Convidada.')).toBeVisible()
  await page.getByRole('button', { name: 'Revelar link' }).click()
  const link = await page.locator('.revealed-link input').inputValue()
  expect(link).toContain(inviteOrigin)

  const guestPage = await context.newPage()
  await guestPage.goto(link)
  const publicArtwork = guestPage.locator('.artwork')
  await expect(publicArtwork.locator('h1')).toHaveText('Convite para Celebração M11')
  await expect(publicArtwork.locator('.artwork-subtitle')).toHaveText('Olá, Ana Convidada')
  await expect(publicArtwork.locator('.artwork-body')).toHaveText('Esperamos você em Jardim das Águas.')
  await expect(publicArtwork).toHaveClass(/artwork--editorial/)
  await guestPage.screenshot({ path: 'test-results/m11-public-invite-desktop.png', fullPage: true })
  await guestPage.setViewportSize({ width: 390, height: 844 })
  await guestPage.screenshot({ path: 'test-results/m11-public-invite-mobile.png', fullPage: true })
  await expect(publicArtwork.locator('.artwork-facts strong').first()).toHaveText(previewDate!)
  await expect(publicArtwork.locator('.artwork-deadline')).toHaveText(previewDeadline!)
  await guestPage.close()
})
