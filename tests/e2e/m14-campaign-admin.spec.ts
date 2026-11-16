import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { test, expect, type Page } from '@playwright/test'

const localEnv = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map(line => {
  const position = line.indexOf('='); return [line.slice(0, position), line.slice(position + 1)]
}))
const origin = localEnv.ADMIN_ORIGIN!
let server: ChildProcess
let backend: Server
const orgId = 'a'.repeat(24)
const eventId = 'b'.repeat(24)
const connectionId = 'c'.repeat(24)
const guestId = 'd'.repeat(24)
const invitationId = 'e'.repeat(24)
const campaignId = 'f'.repeat(24)
const event = { id: eventId, name: 'Encontro de teste', description: '', location: 'Espaço de teste', address: 'Endereço de teste',
  startsAt: '2028-11-15T22:00:00Z', endsAt: '2028-11-16T02:00:00Z', rsvpDeadline: '2028-11-14T22:00:00Z',
  timeZone: 'America/Campo_Grande', status: 'published', publishedTemplateVersion: 1, companionLimit: 0, companionNamesRequired: false }
const guest = { id: guestId, name: 'Contato de teste', phone: '+5567999990001', tags: [], notes: '', whatsappConsent: true }
const invitation = { id: invitationId, guestId, guestName: guest.name, templateVersion: 1, expiresAt: '2028-11-14T22:00:00Z',
  responseStatus: 'pending', companions: [], responseVersion: 0, createdAt: '2026-10-15T12:00:00Z' }

test.beforeAll(async () => {
  backend = createServer(async (request, response) => {
    let bytes = 0
    for await (const chunk of request) bytes += Buffer.byteLength(chunk)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ path: request.url, bytes }))
  }).listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (!address || typeof address === 'string') throw new Error('Backend de teste não iniciou')
  server = spawn(process.execPath, ['apps/admin/.output/server/index.mjs'], {
    env: { ...process.env, NITRO_PORT: localEnv.ADMIN_PORT!, NUXT_API_INTERNAL_URL: `http://127.0.0.1:${address.port}`, NUXT_ADMIN_ORIGIN: origin }, stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 200; attempt++) {
    try { if ((await fetch(origin)).ok) return } catch { /* servidor iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Painel local não iniciou')
}, 30_000)
test.afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited
  }
  if (backend) await new Promise<void>(resolve => backend.close(() => resolve()))
})

async function fixture(page: Page, options: { consent?: boolean; channel?: 'baileys' | 'cloud'; timeZone?: string } = {}) {
  const consent = options.consent ?? true
  const channel = options.channel ?? 'baileys'
  const fixtureEvent = { ...event, timeZone: options.timeZone ?? event.timeZone }
  const calls: Array<{ path: string; method: string; body: any }> = []
  let current = { id: campaignId, eventId, status: 'draft', intervalMs: 5000, previewHash: 'test-hash', approvedMode: 'fake', recipientCount: 1 }
  const preview = () => ({ intervalMs: current.intervalMs, previewHash: current.previewHash, items: [{ invitationId,
    recipient: { name: guest.name, phone: guest.phone, whatsappConsent: consent }, text: `Olá, ${guest.name}. Confirme no link individual.`,
    link: `${origin}/i/link-individual-de-teste`, mode: 'fake', provider: 'evolution', channel, previewHash: 'individual-hash' }] })
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const body = method === 'POST' ? route.request().postDataJSON() : null
    calls.push({ path, method, body })
    if (method === 'POST') expect(route.request().headers()['x-csrf-token']).toBe('csrf-test')
    let json: unknown
    if (path.endsWith('/auth/session')) json = { admin: { email: 'teste@example.test' }, csrfToken: 'csrf-test' }
    else if (path === '/api/admin/organizations') json = { items: [{ id: orgId, name: 'Organização de teste' }, { id: '1'.repeat(24), name: 'Outra organização' }] }
    else if (!path.includes(orgId)) json = { items: [], total: 0, active: null }
    else if (path.endsWith('/events')) json = { items: [fixtureEvent] }
    else if (path.endsWith('/guests/preview')) json = { rows: [
      { line: 1, guest, errors: [], duplicates: [] }, { line: 2, errors: ['Telefone ausente'], duplicates: [] },
    ] }
    else if (path.endsWith('/guests/import')) json = { created: [guest] }
    else if (path.endsWith('/guests')) json = { items: [{ ...guest, whatsappConsent: consent }], total: 1 }
    else if (path.endsWith('/invitations')) json = { items: [invitation], totals: { pending: 1, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 } }
    else if (path.endsWith('/connections/active')) json = { active: { connectionId, revision: 1, provider: 'evolution', channel } }
    else if (path.endsWith('/status')) json = { status: { state: 'connected', mode: 'fake' } }
    else if (path.endsWith('/numbers-preview') || path.endsWith('/numbers-verify')) json = {
      channel, lookupSupported: channel === 'baileys', mode: 'fake', connection: { id: connectionId, instanceName: 'Instância de teste', revision: 1 },
      limits: { batch: 10, perMinute: 10, perDay: 100 }, results: [{ phone: guest.phone, state: channel === 'cloud' ? 'unsupported' : path.endsWith('/numbers-verify') ? 'registered' : 'not_checked',
        ...(path.endsWith('/numbers-verify') ? { checkedAt: '2026-10-15T12:00:00Z' } : {}) }],
    }
    else if (path.endsWith('/campaigns') && method === 'POST') {
      expect(body.invitationIds).toEqual([invitationId])
      current = { ...current, intervalMs: body.intervalMs, previewHash: `hash-${body.intervalMs}` }
      json = { campaign: current, preview: preview() }
    } else if (path.endsWith('/campaigns')) json = { items: [current] }
    else if (path.endsWith(`/campaigns/${campaignId}/preview`)) json = { campaign: current, preview: preview() }
    else if (path.endsWith('/approve') || path.endsWith('/pause') || path.endsWith('/resume')) {
      if (path.endsWith('/approve')) expect(body).toEqual({ approve: true, previewHash: current.previewHash })
      current = { ...current, status: path.endsWith('/pause') ? 'paused' : 'running' }
      json = { campaign: current }
    } else if (path.endsWith(`/campaigns/${campaignId}`)) json = { campaign: { ...current,
      counts: { queued: 0, processing: 0, retry_wait: 0, uncertain: 1, suppressed: 0, completed: 0, failed_permanent: 0 },
      items: [{ deliveryId: 'delivery-test', invitationId, status: 'uncertain', mediaStatus: 'accepted', textStatus: 'uncertain' }],
    } }
    else if (path.endsWith('/assistant')) json = { messages: [], pending: null }
    else throw new Error(`Rota não prevista na fixture: ${method} ${path}`)
    await route.fulfill({ json })
  })
  await page.goto(origin)
  await page.locator('.design-sidebar').getByRole('button', { name: 'Eventos', exact: true }).click()
  await page.getByRole('button', { name: 'Preparar campanha', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Importar e revisar a lista' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Convidados', exact: true })).toHaveCount(0)
  return calls
}

test('importa com seleção, consulta, revisa, aprova simulação, pausa e retoma com confirmação', async ({ page }) => {
  const calls = await fixture(page)
  await page.getByLabel('Arquivo com nomes e telefones').setInputFiles({ name: 'contatos.txt', mimeType: 'text/plain', buffer: Buffer.from('Contato de teste; +5567999990001') })
  await expect(page.getByLabel('Importar linha 2')).toBeDisabled()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByText('Deslize para os lados para ver telefone e revisão.')).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Linha', exact: true })).toHaveCSS('white-space', 'nowrap')
  await page.getByRole('region', { name: 'Prévia dos contatos importados' }).focus()
  await expect(page.getByRole('region', { name: 'Prévia dos contatos importados' })).toBeFocused()
  await page.getByRole('region', { name: 'Prévia dos contatos importados' }).scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const table = await page.getByRole('region', { name: 'Prévia dos contatos importados' }).boundingBox()
    const nav = await page.locator('.design-bottom-nav').boundingBox()
    return Boolean(table && nav && table.y + table.height <= nav.y)
  }).toBe(true)
  await expect.poll(async () => {
    const content = await page.locator('.design-content').boundingBox()
    const nav = await page.locator('.design-bottom-nav').boundingBox()
    return Boolean(content && nav && Math.abs(content.y + content.height - nav.y) < 2)
  }).toBe(true)
  await page.getByRole('button', { name: 'Importar 0 contatos selecionados' }).scrollIntoViewIfNeeded()
  await expect.poll(async () => {
    const button = await page.getByRole('button', { name: 'Importar 0 contatos selecionados' }).boundingBox()
    const nav = await page.locator('.design-bottom-nav').boundingBox()
    return Boolean(button && nav && button.y + button.height <= nav.y)
  }).toBe(true)
  await page.screenshot({ path: 'test-results/m14-import-mobile.png' })
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(page.getByRole('button', { name: 'Importar 0 contatos selecionados' })).toBeDisabled()
  await page.getByLabel('Importar linha 1').check()
  await page.getByLabel(/Declaro que tenho autorização comprovável/).check()
  await expect(page.getByRole('button', { name: 'Importar 1 contato selecionado' })).toBeDisabled()
  await page.getByLabel('Fonte da autorização WhatsApp').fill('Formulário de teste, registro 42')
  await expect(page.getByRole('button', { name: 'Importar 1 contato selecionado' })).toBeEnabled()
  await page.getByLabel(/Declaro que tenho autorização comprovável/).uncheck()
  await page.getByRole('button', { name: 'Importar 1 contato selecionado' }).click()
  expect(calls.find(call => call.path.endsWith('/guests/import'))?.body.whatsappConsent).toBe(false)
  await page.getByRole('button', { name: 'Escolher e verificar contatos' }).click()
  await page.getByLabel('Selecionar Contato de teste', { exact: true }).check()
  await page.getByRole('button', { name: 'Preparar consulta dos selecionados' }).click()
  await expect(page.getByRole('button', { name: 'Consultar próximo lote de até 10' })).toBeDisabled()
  await page.getByLabel(/Confirmo consultar até 10 números/).check()
  await page.getByRole('button', { name: 'Consultar próximo lote de até 10' }).click()
  await expect(page.getByRole('cell', { name: /^Registrado no WhatsApp/ })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar para mensagem' }).click()
  await expect(page.getByRole('button', { name: 'Editar modelo e mensagem' })).toBeVisible()
  await expect(page.getByText('A arte permanece na página individual do convite. No WhatsApp, a campanha envia somente o texto e o link individual.')).toBeVisible()
  await page.getByRole('button', { name: 'Revisar campanha', exact: true }).last().click()
  await expect(page.getByText(/fuso Horário de Ponta Porã\./)).toBeVisible()
  await expect(page.getByText(/America\/Campo_Grande/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Gerar prévia da campanha' }).click()
  await expect(page.getByRole('article', { name: 'Mensagem individual revisada' })).toContainText(guest.name)
  await expect(page.getByRole('button', { name: 'Aprovar campanha simulada' })).toBeDisabled()
  await page.getByLabel(/Revisei 1 destinatário/).check()
  await page.getByLabel('Intervalo mínimo entre tentativas (segundos)').fill('6')
  await expect(page.getByRole('button', { name: 'Aprovar campanha simulada' })).toHaveCount(0)
  expect(calls.filter(call => call.path.endsWith('/approve'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Gerar prévia da campanha' }).click()
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await page.screenshot({ path: 'test-results/m14-campaign-review-desktop.png', fullPage: true })
  await page.getByLabel(/Revisei 1 destinatário/).check()
  await page.getByRole('button', { name: 'Aprovar campanha simulada' }).click()
  await expect(page.getByRole('heading', { name: 'Acompanhar campanhas' })).toBeVisible()
  await page.getByRole('button', { name: 'Atualizar estado', exact: true }).click()
  await expect(page.getByText('Incerto: exige revisão', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pausar campanha' }).click()
  await expect(page.getByRole('button', { name: 'Retomar campanha' })).toBeDisabled()
  await page.getByLabel(/Confirmo retomar o processamento/).check()
  await page.getByRole('button', { name: 'Retomar campanha' }).click()
  await expect(page.getByRole('button', { name: 'Pausar campanha' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/m14-campaign-mobile.png' })
  expect(calls.filter(call => call.path.endsWith('/approve'))).toHaveLength(1)
})

test('proxy transmite importação documental e restringe tamanho, método, caminho e origem', async ({ request }) => {
  const base = `${origin}/api/admin/organizations/${orgId}`
  const headers = { origin, 'x-csrf-token': 'csrf-test' }
  const file = { name: 'contatos.docx', contentBase64: 'A'.repeat(350_000) }
  const accepted = await request.post(`${base}/guests/preview`, { headers, data: { file } })
  expect(accepted.status()).toBe(200)
  expect(await accepted.json()).toMatchObject({ path: `/admin/organizations/${orgId}/guests/preview` })
  expect((await request.post(`${base}/guests/import`, { headers, data: { file: { ...file, contentBase64: 'A'.repeat(360_448) } } })).status()).toBe(413)
  expect((await request.post(`${base}/guests`, { headers, data: { name: 'A'.repeat(16_384) } })).status()).toBe(413)
  expect((await request.get(`${base}/connections/evolution/${connectionId}/numbers-verify`)).status()).toBe(404)
  expect((await request.post(`${base}/events/${eventId}/campaigns/${campaignId}/send`, { headers, data: {} })).status()).toBe(404)
  expect((await request.get(`${base}/events/${eventId}/campaigns?all=1`)).status()).toBe(404)
  expect((await request.post(`${base}/events/${eventId}/campaigns`, { headers: { ...headers, origin: 'https://foreign.example.test' }, data: {} })).status()).toBe(403)
})

test('apresenta um fuso IANA legado com nome humano', async ({ page }) => {
  await fixture(page, { timeZone: 'America/New_York' })
  await page.getByRole('button', { name: 'Escolher e verificar contatos' }).click()
  await page.getByRole('button', { name: 'Continuar para mensagem' }).click()
  await page.getByRole('button', { name: 'Revisar campanha', exact: true }).last().click()
  await expect(page.getByText(/fuso Horário de New York\./)).toBeVisible()
  await expect(page.getByText(/America\/New_York/)).toHaveCount(0)
})

test('mostra bloqueios de consentimento e Cloud, e assistente só navega sem aprovar', async ({ page }) => {
  const calls = await fixture(page, { consent: false, channel: 'cloud' })
  await page.getByRole('button', { name: 'Escolher e verificar contatos' }).click()
  await page.getByLabel('Selecionar Contato de teste', { exact: true }).check()
  await page.getByRole('button', { name: 'Preparar consulta dos selecionados' }).click()
  await expect(page.getByText('Este canal não oferece consulta de existência. O estado permanece inconclusivo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Consultar próximo lote de até 10' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Revisar campanha', exact: true }).click()
  await expect(page.getByText('Há contatos sem consentimento WhatsApp.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gerar prévia da campanha' })).toBeDisabled()
  await page.getByRole('button', { name: 'Abrir assistente' }).click()
  await page.getByText('Preparar uma campanha', { exact: true }).click()
  await page.getByLabel('Evento da campanha').selectOption(eventId)
  await page.getByRole('dialog').getByRole('button', { name: 'Acompanhar campanha', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Acompanhar campanhas' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Importar e revisar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Importar e revisar a lista' })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/approve') || call.path.endsWith('/resume'))).toHaveLength(0)
  expect(calls.filter(call => call.path.endsWith('/assistant') && call.method === 'POST')).toHaveLength(0)
  await page.getByRole('button', { name: 'Fechar assistente' }).click()
  await expect(page.getByRole('button', { name: 'Abrir assistente' })).toBeFocused()
  await page.locator('.design-sidebar').getByRole('combobox', { name: 'Organização' }).selectOption('1'.repeat(24))
  await expect(page.locator('.campaign-workspace')).toHaveCount(0)
})
