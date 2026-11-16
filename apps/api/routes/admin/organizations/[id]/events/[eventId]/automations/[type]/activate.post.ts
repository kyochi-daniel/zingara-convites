import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { activateRule } from '@zingara/automations'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await activateRule(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '',
    getRouterParam(event, 'type') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : result.error === 'CONFLICT' ? 409 : 400,
    statusMessage: result.error === 'CONFLICT' ? 'Prévia desatualizada ou regra indisponível' : 'Regra não encontrada' })
  return result
})
