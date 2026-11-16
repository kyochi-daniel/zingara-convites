import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getEvent } from '@zingara/core'
import { requireAdmin } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const found = await getEvent(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '')
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return { event: found }
})
