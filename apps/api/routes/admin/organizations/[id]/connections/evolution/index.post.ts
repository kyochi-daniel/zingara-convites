import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { evolutionConnectionInput } from '@zingara/contracts'
import { createEvolutionConnection, provisionEvolutionConnection } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = evolutionConnectionInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const result = await createEvolutionConnection(getRouterParam(event, 'id') || '', parsed.data)
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 :
    result.error === 'CONFLICT' ? 409 : result.error === 'UNAVAILABLE' ? 503 : 400,
    statusMessage: result.error === 'UNAVAILABLE' ? 'Evolution indisponível' : 'Conexão inválida' })
  const provisioned = await provisionEvolutionConnection(getRouterParam(event, 'id') || '', result.connection.id)
  if ('error' in provisioned) throw createError({ statusCode: provisioned.error === 'UNAVAILABLE' ? 503 : 409,
    statusMessage: provisioned.error === 'UNAVAILABLE' ? 'Evolution indisponível' : 'Criação em andamento' })
  return provisioned
})
