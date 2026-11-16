import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { saveEvolutionTemplate } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const result = await saveEvolutionTemplate(getRouterParam(event, 'id') || '',
    getRouterParam(event, 'connectionId') || '', await readJson(event))
  if ('error' in result) throw createError({ statusCode: result.error === 'NOT_FOUND' ? 404 :
    result.error === 'INVALID' ? 400 : result.error === 'UNAVAILABLE' ? 503 : 409,
    statusMessage: result.error === 'NOT_APPROVED' ? 'Template não aprovado pela Meta' : 'Template indisponível' })
  return result
})
