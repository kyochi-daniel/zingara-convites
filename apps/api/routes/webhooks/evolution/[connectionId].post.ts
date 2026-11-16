import { createError, defineEventHandler, getHeader, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { allowEvolutionWebhookAttempt, ingestEvolutionWebhook } from '@zingara/core'
import { publicApiClientIp } from '../../../utils/public'

const MAX_BODY = 256 * 1024

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'no-store')
  const sourceIp = publicApiClientIp(event.node.req.socket.remoteAddress,
    getHeader(event, 'x-client-ip') || undefined)
  if (!await allowEvolutionWebhookAttempt(sourceIp)) {
    setHeader(event, 'Retry-After', 60)
    throw createError({ statusCode: 429, statusMessage: 'Muitas tentativas' })
  }
  if (getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  }
  const declared = getHeader(event, 'content-length')
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) {
    throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
    chunks.push(buffer)
  }
  let body: unknown
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON inválido' }) }
  const result = await ingestEvolutionWebhook(getRouterParam(event, 'connectionId') || '',
    getHeader(event, 'x-zingara-webhook-secret') || '', body)
  if ('error' in result) {
    if (result.error === 'RATE_LIMIT') setHeader(event, 'Retry-After', 60)
    throw createError({ statusCode: result.error === 'INVALID' ? 400 : result.error === 'RATE_LIMIT' ? 429 : 401,
      statusMessage: result.error === 'INVALID' ? 'Evento inválido' : 'Instância não autorizada' })
  }
  setResponseStatus(event, 202)
  return result
})
