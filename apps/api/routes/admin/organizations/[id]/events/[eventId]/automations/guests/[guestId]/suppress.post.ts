import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { suppressGuest, suppressionInput } from '@zingara/automations'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const input = suppressionInput.safeParse(await readJson(event))
  if (!input.success) throw createError({ statusCode: 400, statusMessage: 'Motivo inválido' })
  const result = await suppressGuest(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '',
    getRouterParam(event, 'guestId') || '', input.data.reason)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Convidado não encontrado' })
  return result
})
