import { timingSafeEqual } from 'node:crypto'
import { createError, getCookie, getHeader, type H3Event } from 'h3'
import { getAdminSession } from '@zingara/core'

export function requireAdminOrigin(event: H3Event) {
  if (!process.env.ADMIN_ORIGIN || getHeader(event, 'origin') !== process.env.ADMIN_ORIGIN) {
    throw createError({ statusCode: 403, statusMessage: 'Origem não permitida' })
  }
}

export async function requireAdmin(event: H3Event) {
  const token = getCookie(event, 'zingara_session')
  const session = token && await getAdminSession(token)
  if (!session) throw createError({ statusCode: 401, statusMessage: 'Sessão necessária' })
  return session
}

export function requireCsrf(event: H3Event, expected: string) {
  const received = getHeader(event, 'x-csrf-token') || ''
  if (received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    throw createError({ statusCode: 403, statusMessage: 'CSRF inválido' })
  }
}

export async function readJson(event: H3Event) {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) {
    throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 16_384) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON inválido' }) }
}
