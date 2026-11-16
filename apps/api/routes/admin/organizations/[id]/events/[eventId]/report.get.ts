import { createError, defineEventHandler, getHeader, getRouterParam, setHeader } from 'h3'
import { getEventReport } from '@zingara/core'
import { requireAdmin, requireAdminOrigin } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  if (getHeader(event, 'origin')) requireAdminOrigin(event)
  await requireAdmin(event)
  const report = await getEventReport(
    getRouterParam(event, 'id') || '',
    getRouterParam(event, 'eventId') || '',
  )
  if (!report) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return { report }
})
