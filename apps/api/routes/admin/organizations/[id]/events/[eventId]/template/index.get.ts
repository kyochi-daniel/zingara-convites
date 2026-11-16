import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getTemplateDraft } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const template = await getTemplateDraft(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '')
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return { template }
})
