import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { readEvolutionStatus } from '@zingara/core'
import { requireAdmin } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const result = await readEvolutionStatus(getRouterParam(event, 'id') || '', getRouterParam(event, 'connectionId') || '')
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : 503,
    statusMessage: result.error === 'NOT_FOUND' ? 'Conexão não encontrada' : 'Diagnóstico indisponível' })
  return result
})
