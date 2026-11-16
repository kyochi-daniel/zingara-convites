import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { listEvolutionConnections } from '@zingara/core'
import { requireAdmin } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await listEvolutionConnections(getRouterParam(event, 'id') || '')
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return result
})
