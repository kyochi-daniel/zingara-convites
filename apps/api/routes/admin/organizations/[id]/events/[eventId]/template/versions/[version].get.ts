import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getTemplateVersion } from '@zingara/core'
import { requireAdmin } from '../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const publication = await getTemplateVersion(
    getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', Number(getRouterParam(event, 'version')),
  )
  if (!publication) throw createError({ statusCode: 404, statusMessage: 'Versão não encontrada' })
  return { publication }
})
