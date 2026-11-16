import { createError, defineEventHandler, getQuery, getRouterParam, setHeader } from 'h3'
import { listJobs } from '@zingara/automations'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const rawLimit = getQuery(event).limit
  const limit = rawLimit === undefined ? 50 : Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw createError({ statusCode: 400, statusMessage: 'Limite inválido' })
  const result = await listJobs(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', limit)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return result
})
