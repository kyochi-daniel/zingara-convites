import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { createError, getCookie, getHeader, getRequestURL, type H3Event } from 'h3'

const TOKEN = /^[A-Za-z0-9_-]{43}$/
const MAX_PROXY_ATTEMPT_SUBJECTS = 10_000
const webhookProxyAttempts = new Map<string, { window: number, count: number }>()
export const MAX_RSVP_BYTES = 4096

export function publicClientIp(remoteAddress: string | undefined, forwardedFor: string | string[] | undefined, trustedProxyIps: string): string {
  const remote = remoteAddress?.replace(/^::ffff:/, '') || ''
  const trusted = new Set(trustedProxyIps.split(',').map(ip => ip.trim().replace(/^::ffff:/, '')).filter(ip => isIP(ip)))
  if (!trusted.has(remote) || typeof forwardedFor !== 'string' || forwardedFor.length > 1024) return remote || 'unknown'
  const hops = forwardedFor.split(',')
  if (hops.length > 16) return remote || 'unknown'
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index]?.trim().replace(/^::ffff:/, '') || ''
    if (!isIP(hop)) return remote || 'unknown'
    if (!trusted.has(hop)) return hop
  }
  return remote || 'unknown'
}

export function allowWebhookProxyAttempt(sourceIp: string, now = Date.now()) {
  const configured = Number(process.env.WEBHOOK_ATTEMPT_LIMIT)
  const limit = Number.isInteger(configured) && configured >= 1 && configured <= 100_000 ? configured : 120
  const window = Math.floor(now / 60_000)
  const current = webhookProxyAttempts.get(sourceIp)
  if (current?.window === window) {
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
  if (!current && webhookProxyAttempts.size >= MAX_PROXY_ATTEMPT_SUBJECTS) {
    for (const [ip, attempt] of webhookProxyAttempts) {
      if (attempt.window !== window) webhookProxyAttempts.delete(ip)
    }
    if (webhookProxyAttempts.size >= MAX_PROXY_ATTEMPT_SUBJECTS) return false
  }
  // shortcut: quota local é por processo; a API mantém a quota persistente para múltiplas réplicas.
  webhookProxyAttempts.set(sourceIp, { window, count: 1 })
  return true
}

export function invitationTarget(apiInternalUrl: string, token: string, rsvp = false): string | null {
  if (!TOKEN.test(token)) return null
  try {
    const base = new URL(apiInternalUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null
    return new URL(`/public/invitations/${token}${rsvp ? '/rsvp' : ''}`, base).toString()
  } catch { return null }
}

export function publicResponseHeaders(event: H3Event) {
  event.node.res.setHeader('cache-control', 'private, no-store')
  event.node.res.setHeader('referrer-policy', 'no-referrer')
  event.node.res.setHeader('x-robots-tag', 'noindex, nofollow, noarchive')
  event.node.res.setHeader('x-content-type-options', 'nosniff')
}

export function requirePublicMutation(event: H3Event, token: string, expectedOrigin: string) {
  if (getRequestURL(event).search || getHeader(event, 'origin') !== expectedOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'Origem não permitida' })
  }
  if (!/^application\/json(?:\s*;|$)/i.test(getHeader(event, 'content-type') || '')) {
    throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  }
  const expected = getCookie(event, 'zingara_rsvp_csrf') || ''
  const received = getHeader(event, 'x-rsvp-csrf') || ''
  if (!expected || expected.length !== received.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) {
    throw createError({ statusCode: 403, statusMessage: 'CSRF inválido' })
  }
  if (!TOKEN.test(token)) throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
}

export async function readPublicJson(event: H3Event) {
  const chunks: Buffer[] = []
  let size = 0
  const length = Number(getHeader(event, 'content-length'))
  if (length > MAX_RSVP_BYTES) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_RSVP_BYTES) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
    chunks.push(buffer)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return JSON.stringify(body)
  } catch { throw createError({ statusCode: 400, statusMessage: 'JSON inválido' }) }
}
