import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { revisePublishedEvent } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await revisePublishedEvent(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : result.error === 'CONFLICT' ? 409 : 400,
    statusMessage: result.error === 'NOT_FOUND' ? 'Evento não encontrado' : result.error === 'CONFLICT' ? 'Revisão desatualizada ou evento indisponível' : 'Revisão inválida' })
  return result
})
