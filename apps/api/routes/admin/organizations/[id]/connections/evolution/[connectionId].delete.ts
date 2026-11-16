import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { retireEvolutionConnection } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await retireEvolutionConnection(getRouterParam(event, 'id') || '', getRouterParam(event, 'connectionId') || '')
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : result.error === 'UNAVAILABLE' ? 503 : 409,
    statusMessage: result.error === 'NOT_FOUND' ? 'Conexão não encontrada' : result.error === 'UNAVAILABLE' ? 'Evolution indisponível' : 'Conexão em uso' })
  return result
})
