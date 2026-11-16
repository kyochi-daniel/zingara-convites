import { createError, defineEventHandler, getRouterParam } from 'h3'
import { guestPatch } from '@zingara/contracts'
import { updateGuest } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = guestPatch.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  let updated
  try {
    updated = await updateGuest(getRouterParam(event, 'id') || '', getRouterParam(event, 'guestId') || '', parsed.data, session.admin.id)
  } catch (error) {
    if (error instanceof Error && error.message === 'GUEST_CONFLICT') {
      throw createError({ statusCode: 409, statusMessage: 'Contato alterado por outra operação. Recarregue e tente novamente.' })
    }
    throw error
  }
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Contato não encontrado' })
  return { guest: updated }
})
