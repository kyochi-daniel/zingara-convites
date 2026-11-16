import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { listEvolutionTemplates } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await listEvolutionTemplates(getRouterParam(event, 'id') || '', getRouterParam(event, 'connectionId') || '')
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : 409,
    statusMessage: 'Templates indisponíveis' })
  return result
})
