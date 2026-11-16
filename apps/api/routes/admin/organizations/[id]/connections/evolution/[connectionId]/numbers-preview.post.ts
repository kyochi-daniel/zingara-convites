import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { previewEvolutionNumbers } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await previewEvolutionNumbers(getRouterParam(event, 'id') || '',
    getRouterParam(event, 'connectionId') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 : 400,
    statusMessage: 'Prévia indisponível' })
  return result
})
