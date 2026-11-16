import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { checkEvolutionNumber } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const input = await readJson(event)
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).length !== 1 || !('phone' in input) ||
    typeof input.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(input.phone)) {
    throw createError({ statusCode: 400, statusMessage: 'Número inválido' })
  }
  const result = await checkEvolutionNumber(getRouterParam(event, 'id') || '',
    getRouterParam(event, 'connectionId') || '', input.phone)
  if ('error' in result) {
    if (result.error === 'RATE_LIMIT') setHeader(event, 'Retry-After', result.retryAfterSeconds)
    throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : result.error === 'INVALID' ? 400 :
      result.error === 'RATE_LIMIT' ? 429 : result.error === 'UNSUPPORTED' || result.error === 'CONFLICT' ? 409 : 503,
    statusMessage: 'Consulta indisponível' })
  }
  return result
})
