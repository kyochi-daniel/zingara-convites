import { createError, defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { guestInput } from '@zingara/contracts'
import { createGuest } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = guestInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const created = await createGuest(getRouterParam(event, 'id') || '', parsed.data, session.admin.id)
  if (!created) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  setResponseStatus(event, 201)
  return { guest: created }
})
