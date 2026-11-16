import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { verifyEvolutionNumbers } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await verifyEvolutionNumbers(getRouterParam(event, 'id') || '',
    getRouterParam(event, 'connectionId') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 :
    result.error === 'UNSUPPORTED' || result.error === 'CONFLICT' ? 409 : 400, statusMessage: 'Consulta indisponível' })
  const limited = result.results.find(item => item.state === 'rate_limited')
  if (limited?.retryAfterSeconds) setHeader(event, 'Retry-After', limited.retryAfterSeconds)
  return result
})
