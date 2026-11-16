import { createError, defineEventHandler, getHeader, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { allowWebhookProxyAttempt, publicClientIp } from '../../../utils/public-invitation-proxy'

const MAX_BODY = 256 * 1024

export default defineEventHandler(async event => {
  const sourceIp = publicClientIp(event.node.req.socket.remoteAddress,
    event.node.req.headers['x-forwarded-for'], process.env.TRUSTED_PROXY_IPS || '')
  if (!allowWebhookProxyAttempt(sourceIp)) {
    setResponseHeader(event, 'retry-after', 60)
    throw createError({ statusCode: 429, statusMessage: 'Muitas tentativas' })
  }
  if (getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Conteúdo não aceito' })
  }
  const length = getHeader(event, 'content-length')
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) {
    throw createError({ statusCode: 413, statusMessage: 'Evento muito grande' })
  }
  const connectionId = getRouterParam(event, 'connectionId') || ''
  if (!/^[a-f\d]{24}$/i.test(connectionId)) throw createError({ statusCode: 404, statusMessage: 'Instância não encontrada' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) throw createError({ statusCode: 413, statusMessage: 'Evento muito grande' })
    chunks.push(buffer)
  }
  let target: URL
  try {
    const base = new URL(useRuntimeConfig(event).apiInternalUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
    target = new URL(`/webhooks/evolution/${connectionId}`, base)
  } catch { throw createError({ statusCode: 503, statusMessage: 'Recepção indisponível' }) }
  let response: Response
  try {
    response = await fetch(target, { method: 'POST', headers: {
      'content-type': 'application/json', 'x-zingara-webhook-secret': getHeader(event, 'x-zingara-webhook-secret') || '',
      'x-client-ip': sourceIp,
    }, body: Buffer.concat(chunks), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(5000) })
  } catch { throw createError({ statusCode: 503, statusMessage: 'Recepção indisponível' }) }
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after') || ''
    if (response.status === 429 && /^\d{1,5}$/.test(retryAfter)) event.node.res.setHeader('retry-after', retryAfter)
    throw createError({ statusCode: [400, 401, 413, 415, 429].includes(response.status) ? response.status : 503,
      statusMessage: 'Evento não aceito' })
  }
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseStatus(event, 202)
  return { accepted: true }
})
