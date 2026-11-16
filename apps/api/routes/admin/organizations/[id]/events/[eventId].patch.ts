import { createError, defineEventHandler, getRouterParam } from 'h3'
import { eventPatch } from '@zingara/contracts'
import { updateEvent } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = eventPatch.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  let updated
  try { updated = await updateEvent(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', parsed.data) }
  catch (error) {
    if (error instanceof Error && error.name === 'ZodError') throw createError({ statusCode: 400, statusMessage: 'Datas inválidas' })
    throw error
  }
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return { event: updated }
})
