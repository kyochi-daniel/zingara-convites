import { createError, defineEventHandler, getRouterParam } from 'h3'
import { listInvitations } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const result = await listInvitations(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return result
})
