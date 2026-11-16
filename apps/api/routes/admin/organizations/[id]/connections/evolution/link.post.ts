import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { evolutionBindInput } from '@zingara/contracts'
import { bindEvolutionConnection } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = evolutionBindInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const result = await bindEvolutionConnection(getRouterParam(event, 'id') || '', parsed.data)
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 :
    result.error === 'CONFLICT' ? 409 : result.error === 'UNAVAILABLE' ? 503 : 400,
    statusMessage: 'Vínculo Evolution não autorizado' })
  return result
})
