import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { listRules } from '@zingara/automations'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await listRules(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return result
})
