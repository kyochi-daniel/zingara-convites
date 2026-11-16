import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { saveRule } from '@zingara/automations'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await saveRule(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '',
    getRouterParam(event, 'type') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : result.error === 'CONFLICT' ? 409 : 400,
    statusMessage: result.error === 'CONFLICT' ? 'Revisão desatualizada' : result.error === 'NOT_FOUND' ? 'Evento não encontrado' : 'Regra inválida' })
  return result
})
