import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getGuest } from '@zingara/core'
import { requireAdmin } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const found = await getGuest(getRouterParam(event, 'id') || '', getRouterParam(event, 'guestId') || '')
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Contato não encontrado' })
  return { guest: found }
})
