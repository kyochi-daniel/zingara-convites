import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { createError, getHeader, setHeader, type H3Event } from 'h3'
import { connectDatabase, LoginAttemptModel } from '@zingara/database'

export function privateResponse(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Robots-Tag', 'noindex')
}

export function requireInviteOrigin(event: H3Event) {
  if (!process.env.INVITE_ORIGIN || getHeader(event, 'origin') !== process.env.INVITE_ORIGIN) {
    throw createError({ statusCode: 403, statusMessage: 'Origem não permitida' })
  }
}

export function publicApiClientIp(remoteAddress: string | undefined, forwardedIp: string | undefined) {
  const transport = remoteAddress || ''
  const ipv4 = transport.startsWith('::ffff:') ? transport.slice(7) : transport
  const privateTransport = ipv4 === '::1' || ipv4 === '127.0.0.1' || ipv4.startsWith('10.') ||
    ipv4.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ipv4) ||
    /^(fc|fd|fe80):/i.test(ipv4)
  return privateTransport && forwardedIp && isIP(forwardedIp) ? forwardedIp : (transport || 'unknown')
}

export async function publicRateLimit(event: H3Event, action: 'read' | 'write') {
  const windowMs = 15 * 60_000
  const window = Math.floor(Date.now() / windowMs)
  const ip = publicApiClientIp(event.node.req.socket.remoteAddress, getHeader(event, 'x-client-ip') || undefined)
  const subject = createHash('sha256').update(ip).digest('hex')
  await connectDatabase()
  const bucket = await LoginAttemptModel.findOneAndUpdate(
    { _id: `public:${action}:${subject}:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) } },
    { upsert: true, new: true },
  )
  if (bucket.count > (action === 'write' ? 30 : 120)) throw createError({ statusCode: 429, statusMessage: 'Muitas tentativas' })
}

export async function readPublicJson(event: H3Event) {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) {
    throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 4096) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON inválido' }) }
}
