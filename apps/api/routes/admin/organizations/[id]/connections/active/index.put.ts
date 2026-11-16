import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { activeConnectionInput } from '@zingara/contracts'
import { selectActiveConnection } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = activeConnectionInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const result = await selectActiveConnection(getRouterParam(event, 'id') || '', parsed.data.connectionId,
    parsed.data.provider, parsed.data.revision)
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : 409,
    statusMessage: result.error === 'NOT_FOUND' ? 'Conexão não encontrada' : 'Conexão alterada' })
  return result
})
