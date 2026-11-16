import { createError, defineEventHandler, getRouterParam } from 'h3'
import { revokeInvitation } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await revokeInvitation(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', getRouterParam(event, 'invitationId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Convite não encontrado' })
  return result
})
