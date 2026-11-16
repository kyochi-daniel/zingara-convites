import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { connectEvolution } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await connectEvolution(getRouterParam(event, 'id') || '', getRouterParam(event, 'connectionId') || '')
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 :
    result.error === 'UNAVAILABLE' ? 503 : 409, statusMessage: 'Conexão indisponível' })
  return result
})
