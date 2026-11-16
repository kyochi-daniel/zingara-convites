import { createError, defineEventHandler, getRouterParam } from 'h3'
import { listDeliveries } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const result = await listDeliveries(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return result
})
