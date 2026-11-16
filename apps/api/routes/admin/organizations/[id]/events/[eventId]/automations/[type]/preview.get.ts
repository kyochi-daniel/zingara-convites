import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { previewRule } from '@zingara/automations'
import { requireAdmin } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await previewRule(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', getRouterParam(event, 'type') || '')
  if ('error' in result) throw createError({ statusCode: 404, statusMessage: 'Regra não encontrada' })
  return result
})
