import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { expect, test } from '@playwright/test'

const imageToken = 'a'.repeat(43)
const genericToken = 'b'.repeat(43)
const imageAssetId = 'c'.repeat(32)
const processList: ChildProcess[] = []
let apiServer: Server
let inviteOrigin = ''

async function freePort() {
  const server = createNetServer()
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

function invitation(image: boolean) {
  return {
    guest: { name: 'Ana Convidada' },
    event: {
      name: 'Evento Exemplo',
      location: 'Zingara',
      address: 'Rua Exemplo, 123',
      startsAt: '2027-01-15T21:00:00.000Z',
      timeZone: 'America/Campo_Grande',
    },
    template: {
      layout: 'editorial',
      title: '{{evento.nome}}',
      subtitle: 'Olá, {{convidado.nome}}',
      body: 'Esperamos você em {{evento.local}}.',
      primaryButtonText: 'Confirmar presença',
      secondaryButtonText: 'Ver endereço',
      alignment: 'center',
      font: 'sans',
      colors: { background: '#f4ebdd', text: '#2b2520', accent: '#92543a' },
      blocks: { date: true, location: true, rsvp: true },
      ...(image ? { imageAssetId } : {}),
    },
    response: { status: 'pending', companions: [], version: 0 },
    companionLimit: 0,
    companionNamesRequired: false,
    rsvpDeadline: '2027-01-12T23:00:00.000Z',
    expiresAt: '2027-01-16T01:00:00.000Z',
  }
}

test.beforeAll(async () => {
  const apiPort = await freePort()
  const invitePort = await freePort()
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  inviteOrigin = `http://127.0.0.1:${invitePort}`

  apiServer = createServer((request, response) => {
    if (request.url === `/public/invitations/${imageToken}` || request.url === `/public/invitations/${genericToken}`) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ invitation: invitation(request.url.endsWith(imageToken)) }))
      return
    }
    if (request.url === `/media/${imageAssetId}`) {
      response.writeHead(200, { 'content-type': 'image/webp' })
      response.end(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'))
      return
    }
    response.writeHead(404)
    response.end()
  })
  apiServer.listen(apiPort, '127.0.0.1')
  await once(apiServer, 'listening')

  processList.push(spawn(process.execPath, ['apps/invite/.output/server/index.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NITRO_PORT: String(invitePort),
      NUXT_API_INTERNAL_URL: apiOrigin,
      NUXT_INVITE_ORIGIN: inviteOrigin,
    },
    stdio: 'ignore',
  }))
  await waitFor(inviteOrigin)
}, 30_000)

test.afterAll(async () => {
  for (const child of processList) child.kill('SIGTERM')
  if (apiServer) await new Promise<void>(resolve => apiServer.close(() => resolve()))
})

test('convite com imagem usa CTA sobre a arte e leva ao único formulário', async ({ page }) => {
  await page.goto(`${inviteOrigin}/i/${imageToken}#responder`)

  await expect(page.locator('.public-topline')).toHaveCount(0)
  await expect(page.getByText('Um convite para você')).toHaveCount(0)
  const hero = page.locator('.invitation-hero--image')
  await expect(hero).toBeVisible()
  await expect(hero.locator('img.artwork-image')).toBeVisible()
  const cta = hero.getByRole('link', { name: 'Confirmar presença' })
  await expect(cta).toHaveAttribute('href', '#responder')
  await expect(page.locator('#responder form')).toHaveCount(1)

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.locator('#responder').evaluate(element => {
    const original = element.scrollIntoView.bind(element)
    const state = window as typeof window & { rsvpScrollCalls: number }
    state.rsvpScrollCalls = 0
    element.scrollIntoView = options => {
      state.rsvpScrollCalls += 1
      original(options)
    }
  })
  await cta.click()
  await expect(page).toHaveURL(/#responder$/)
  await expect(page.locator('#responder')).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { rsvpScrollCalls: number }).rsvpScrollCalls)).toBe(1)
})

test('convite sem imagem preserva o template genérico e seu CTA interno', async ({ page }) => {
  await page.goto(`${inviteOrigin}/i/${genericToken}`)

  await expect(page.locator('.public-topline')).toHaveCount(0)
  await expect(page.locator('.invitation-hero--image')).toHaveCount(0)
  const artwork = page.locator('.artwork')
  await expect(artwork).toBeVisible()
  await expect(artwork.getByRole('heading', { name: 'Evento Exemplo' })).toBeVisible()
  const cta = artwork.getByRole('link', { name: 'Confirmar presença' })
  await expect(cta).toHaveAttribute('href', '#responder')

  await cta.click()
  await expect(page).toHaveURL(/#responder$/)
  await expect(page.locator('#responder')).toBeInViewport()
})
