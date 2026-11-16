import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { expect, test, type Page } from '@playwright/test'

const localEnv = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map(line => {
  const position = line.indexOf('='); return [line.slice(0, position), line.slice(position + 1)]
}))
const origin = localEnv.ADMIN_ORIGIN!
const organizationId = 'a'.repeat(24)
const otherOrganizationId = '1'.repeat(24)
const eventId = 'b'.repeat(24)
const otherEventId = '2'.repeat(24)
const guestId = 'd'.repeat(24)
let server: ChildProcess
let backend: Server

const event = { id: eventId, name: 'Celebração de relatório', description: '', location: 'Salão principal', address: 'Rua Um, 10',
  startsAt: '2028-11-15T22:00:00Z', endsAt: '2028-11-16T02:00:00Z', rsvpDeadline: '2028-11-14T22:00:00Z',
  timeZone: 'America/Campo_Grande', status: 'published', publishedTemplateVersion: 1, companionLimit: 2, companionNamesRequired: false }
const otherEvent = { ...event, id: otherEventId, name: 'Evento de outra organização' }
const confirmed = Array.from({ length: 125 }, (_, index) => ({
  invitationId: (index + 10).toString(16).padStart(24, '0'),
  guestId: (index + 200).toString(16).padStart(24, '0'),
  name: index === 124 ? 'Última Confirmada' : `Convidada ${index + 1}`,
  phone: index === 124 ? '+595981234567' : `+55679999${String(index).padStart(4, '0')}`,
  peopleCount: index < 15 ? 2 : 1,
}))

test.beforeAll(async () => {
  backend = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consome o corpo encaminhado */ }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ path: request.url }))
  }).listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (!address || typeof address === 'string') throw new Error('Backend de teste não iniciou')
  server = spawn(process.execPath, ['apps/admin/.output/server/index.mjs'], {
    env: { ...process.env, NITRO_PORT: localEnv.ADMIN_PORT!, NUXT_API_INTERNAL_URL: `http://127.0.0.1:${address.port}`, NUXT_ADMIN_ORIGIN: origin },
    stdio: 'ignore',
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

async function fixture(page: Page) {
  let failReports = false
  const reportPaths: string[] = []
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  await page.route('**/api/admin/**', async route => {
    const path = new URL(route.request().url()).pathname
    const otherScope = path.includes(otherOrganizationId)
    let json: unknown
    if (path.endsWith('/auth/session')) json = { admin: { email: 'relatorio@example.test' }, csrfToken: 'csrf-test' }
    else if (path === '/api/admin/organizations') json = { items: [
      { id: organizationId, name: 'Organização do relatório' },
      { id: otherOrganizationId, name: 'Outra organização' },
    ] }
    else if (path.endsWith('/report')) {
      reportPaths.push(path)
      if (failReports) {
        await route.fulfill({ status: 503, json: { error: 'detalhe privado' } })
        return
      }
      json = otherScope ? {
        report: {
          eventId: otherEventId, eventName: otherEvent.name, generatedAt: '2026-10-19T12:00:00.000Z',
          messages: { total: 0, accepted: 0, delivered: 0, read: 0, awaitingDelivery: 0, failed: 0 },
          rsvp: { pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 }, confirmed: [],
        },
      } : {
        report: {
          eventId, eventName: event.name, generatedAt: '2026-10-19T12:00:00.000Z',
          messages: { total: 130, accepted: 126, delivered: 120, read: 87, awaitingDelivery: 6, failed: 4 },
          rsvp: { pending: 3, accepted: 125, declined: 2, revoked: 0, peopleConfirmed: 140 }, confirmed,
        },
      }
    } else if (path.endsWith('/events')) json = { items: [otherScope ? otherEvent : event] }
    else if (path.endsWith('/guests')) json = { items: [{ id: guestId, name: 'Contato da emissão', phone: '+5567999990000', tags: [] }], total: 1 }
    else if (path.endsWith('/invitations')) json = { items: [], totals: { pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 } }
    else if (path.endsWith('/assistant')) json = { messages: [], pending: null }
    else throw new Error(`Rota não prevista na fixture: ${route.request().method()} ${path}`)
    await route.fulfill({ json })
  })
  await page.goto(origin)
  await page.locator('.design-sidebar').getByRole('button', { name: 'Eventos', exact: true }).click()
  await page.getByRole('button', { name: 'Gerenciar convites', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Acompanhamento do evento' })).toBeVisible()
  return {
    setReportFailure: (value: boolean) => { failReports = value },
    reportPaths,
  }
}

test('mostra, copia e isola o relatório completo no desktop e mobile', async ({ page }) => {
  const control = await fixture(page)
  const report = page.getByRole('region', { name: 'Acompanhamento do evento' })
  await expect(report.getByText('Contatos de teste não entram nos totais.')).toBeVisible()
  await expect(report.getByText('Entregues', { exact: true }).locator('..')).toContainText('120')
  await expect(report.getByText('Lidas', { exact: true }).locator('..')).toContainText('87')
  await expect(report.getByText('Presenças confirmadas', { exact: true }).locator('..')).toContainText('140')
  await expect(report.getByText('Entregues inclui lidas. Leituras dependem dos recibos do WhatsApp.')).toBeVisible()
  await expect(report.getByText('Pendentes', { exact: true }).locator('..')).toContainText('3')
  await expect(report.getByText('Confirmados', { exact: true }).locator('..')).toContainText('125')
  await expect(report.getByText('Recusados', { exact: true }).locator('..')).toContainText('2')
  await expect(report.getByText('Revogados', { exact: true }).locator('..')).toContainText('0')
  await expect(report.getByText('125 convites confirmados · 140 pessoas')).toBeVisible()
  await expect(report.locator('tbody tr')).toHaveCount(125)
  await expect(report.getByRole('cell', { name: 'Última Confirmada' })).toBeVisible()
  expect(control.reportPaths).toContain(`/api/admin/organizations/${organizationId}/events/${eventId}/report`)

  await report.getByRole('button', { name: 'Copiar confirmados' }).click()
  await expect(report.getByText('Lista completa de confirmados copiada.')).toBeVisible()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('Confirmados — Celebração de relatório')
  expect(copied).toContain('Total: 125 convites confirmados · 140 pessoas')
  expect(copied).toContain('125. Última Confirmada — +595981234567')
  expect(copied.match(/^\d+\. /gm)).toHaveLength(125)

  await page.screenshot({ path: 'test-results/event-report-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => {
    const reportBox = await report.boundingBox()
    return reportBox ? reportBox.x + reportBox.width : Number.POSITIVE_INFINITY
  }).toBeLessThanOrEqual(390)
  await expect.poll(() => page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  const confirmedRegion = report.getByRole('region', { name: 'Confirmados do evento' })
  await expect(confirmedRegion).toBeVisible()
  expect(await confirmedRegion.evaluate(element => element.scrollWidth >= element.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/event-report-mobile.png', fullPage: true })

  control.setReportFailure(true)
  await report.getByRole('button', { name: 'Atualizar relatório' }).click()
  await expect(report.getByRole('alert')).toContainText('dados exibidos podem estar desatualizados')
  await expect(report.locator('tbody tr')).toHaveCount(125)
  await expect(report.getByText('detalhe privado')).toHaveCount(0)

  control.setReportFailure(false)
  await page.locator('.design-mobile-header').getByRole('combobox', { name: 'Organização' }).selectOption(otherOrganizationId)
  await expect(page.getByText('Última Confirmada')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Acompanhamento do evento' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Gerenciar convites', exact: true }).click()
  const otherReport = page.getByRole('region', { name: 'Acompanhamento do evento' })
  await expect(otherReport.getByText('Nenhum convite confirmado neste evento.')).toBeVisible()
  await expect(otherReport.getByRole('button', { name: 'Copiar confirmados' })).toBeDisabled()
  expect(control.reportPaths).toContain(`/api/admin/organizations/${otherOrganizationId}/events/${otherEventId}/report`)
})
