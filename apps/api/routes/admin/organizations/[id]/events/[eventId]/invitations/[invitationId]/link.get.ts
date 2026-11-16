import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { getInvitationLink } from '@zingara/core'
import { requireAdmin } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  await requireAdmin(event)
  const result = await getInvitationLink(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', getRouterParam(event, 'invitationId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Convite não encontrado' })
  if ('error' in result) throw createError({ statusCode: 409, statusMessage: 'Convite revogado' })
  return result
})
