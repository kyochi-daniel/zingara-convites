import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { rotateInvitation } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await rotateInvitation(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', getRouterParam(event, 'invitationId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Convite não encontrado' })
  if ('error' in result) throw createError({ statusCode: 409, statusMessage: 'Convite expirado ou alterado' })
  return result
})
