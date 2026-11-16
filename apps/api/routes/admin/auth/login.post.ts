import { createError, defineEventHandler, setCookie } from 'h3'
import { isIP } from 'node:net'
import { loginInput } from '@zingara/contracts'
import { loginAdmin } from '@zingara/core'
import { readJson, requireAdminOrigin } from '../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const parsed = loginInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const transportIp = event.node.req.socket.remoteAddress || 'unknown'
  const forwardedIp = event.node.req.headers['x-client-ip']
  const sourceIp = typeof forwardedIp === 'string' && isIP(forwardedIp) ? forwardedIp : transportIp
  const result = await loginAdmin(parsed.data.email, parsed.data.password, sourceIp)
  if ('error' in result) {
    throw createError({ statusCode: result.error === 'RATE_LIMIT' ? 429 : 401, statusMessage: result.error === 'RATE_LIMIT' ? 'Muitas tentativas' : 'Credenciais inválidas' })
  }
  setCookie(event, 'zingara_session', result.token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 7200,
  })
  return { admin: result.admin, csrfToken: result.csrfToken }
})
