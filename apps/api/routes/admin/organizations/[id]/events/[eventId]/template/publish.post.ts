import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { publishTemplate } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'
import { assetBelongsToOrganization } from '../../../../../../../utils/assets'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const organizationId = getRouterParam(event, 'id') || ''
  const eventId = getRouterParam(event, 'eventId') || ''
  const result = await publishTemplate(organizationId, eventId, assetBelongsToOrganization)
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
    if (result.error === 'NO_DRAFT') throw createError({ statusCode: 400, statusMessage: 'Rascunho ausente ou inválido' })
    if (result.error === 'INVALID_ASSET') throw createError({ statusCode: 400, statusMessage: 'Imagem inválida' })
    throw createError({ statusCode: 409, statusMessage: 'Publicação concorrente; tente novamente' })
  }
  setResponseStatus(event, 201)
  return result
})
