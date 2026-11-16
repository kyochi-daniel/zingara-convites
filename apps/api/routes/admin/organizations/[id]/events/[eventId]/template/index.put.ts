import { createError, defineEventHandler, getRouterParam } from 'h3'
import { templateInput } from '@zingara/contracts'
import { saveTemplateDraft } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'
import { assetBelongsToOrganization } from '../../../../../../../utils/assets'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = templateInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Template inválido' })
  const organizationId = getRouterParam(event, 'id') || ''
  if (parsed.data.imageAssetId && !await assetBelongsToOrganization(parsed.data.imageAssetId, organizationId)) {
    throw createError({ statusCode: 400, statusMessage: 'Imagem inválida' })
  }
  const template = await saveTemplateDraft(organizationId, getRouterParam(event, 'eventId') || '', parsed.data)
  if (!template) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return { template }
})
