import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { previewInitialDelivery } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  await requireAdmin(event)
  const invitationId = getQuery(event).invitationId
  if (typeof invitationId !== 'string') throw createError({ statusCode: 400, statusMessage: 'Convite inválido' })
  const result = await previewInitialDelivery(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', invitationId)
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Convite não encontrado' })
    throw createError({ statusCode: 409, statusMessage: 'Convite ou conexão indisponível' })
  }
  return result
})
