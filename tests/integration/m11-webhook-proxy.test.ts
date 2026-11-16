import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'

let api: Server
let invite: ChildProcess
let inviteOrigin: string
const receivedIps: string[] = []

async function freePort() {
  const server = createNetServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}

beforeAll(async () => {
  const apiPort = await freePort()
  api = createServer((request, response) => {
    receivedIps.push(String(request.headers['x-client-ip'] || ''))
    request.resume()
    response.writeHead(202, { 'content-type': 'application/json' })
    response.end('{"accepted":true}')
  })
  api.listen(apiPort, '127.0.0.1')
  await once(api, 'listening')

  const invitePort = await freePort()
  inviteOrigin = `http://127.0.0.1:${invitePort}`
  invite = spawn(process.execPath, ['apps/invite/.output/server/index.mjs'], { cwd: process.cwd(), stdio: 'ignore', env: {
    ...process.env,
    NITRO_PORT: String(invitePort),
    NUXT_API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
    TRUSTED_PROXY_IPS: '127.0.0.1',
    WEBHOOK_ATTEMPT_LIMIT: '2',
  } })
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(inviteOrigin)).ok) return }
    catch { /* servidor iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Invite não iniciou')
}, 20_000)

afterAll(async () => {
  invite?.kill('SIGTERM')
  if (api) await new Promise<void>(resolve => api.close(() => resolve()))
})

test('proxy limita antes do corpo e encaminha o hop confiável à direita', async () => {
  const url = `${inviteOrigin}/webhooks/evolution/0123456789abcdef01234567`
  const send = (body: string) => fetch(url, { method: 'POST', headers: {
    'content-type': 'application/json',
    'x-forwarded-for': '198.51.100.66, 203.0.113.9',
    'x-zingara-webhook-secret': 'test-secret',
  }, body })
  expect((await send('{}')).status).toBe(202)
  expect((await send('{}')).status).toBe(202)
  const limited = await send(JSON.stringify({ padding: 'x'.repeat(262_144) }))
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('60')
  expect(receivedIps).toEqual(['203.0.113.9', '203.0.113.9'])
})
