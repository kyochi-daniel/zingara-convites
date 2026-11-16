import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { guestListQuery } from '@zingara/contracts'
import { listGuests } from '@zingara/core'
import { requireAdmin } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const parsed = guestListQuery.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Consulta inválida' })
  const result = await listGuests(getRouterParam(event, 'id') || '', parsed.data)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return result
})
