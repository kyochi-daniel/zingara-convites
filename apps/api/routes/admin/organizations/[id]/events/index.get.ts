import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { listQuery } from '@zingara/contracts'
import { listEvents } from '@zingara/core'
import { requireAdmin } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const parsed = listQuery.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Consulta inválida' })
  const result = await listEvents(getRouterParam(event, 'id') || '', parsed.data)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return result
})
