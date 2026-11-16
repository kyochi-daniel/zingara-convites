import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { listEvolutionInventory } from '@zingara/core'
import { requireAdmin } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await listEvolutionInventory(getRouterParam(event, 'id') || '')
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : 503,
    statusMessage: 'Inventário Evolution indisponível' })
  return result
})
