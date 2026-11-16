import { createError, defineEventHandler, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { invitationCreateInput } from '@zingara/contracts'
import { createInvitation } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = invitationCreateInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Convite inválido' })
  const result = await createInvitation(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', parsed.data)
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Evento ou convidado não encontrado' })
    if (result.error === 'NOT_PUBLISHED') throw createError({ statusCode: 409, statusMessage: 'Evento não publicado' })
    if (result.error === 'REVOKED') throw createError({ statusCode: 409, statusMessage: 'Convite revogado; use rotação' })
    throw createError({ statusCode: 400, statusMessage: 'Expiração inválida' })
  }
  setResponseStatus(event, result.created ? 201 : 200)
  return { invitation: result.invitation, link: result.link }
})
