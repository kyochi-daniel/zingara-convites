import { createError, defineEventHandler, getRouterParam } from 'h3'
import { organizationPatch } from '@zingara/contracts'
import { updateOrganization } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = organizationPatch.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  const organization = await updateOrganization(getRouterParam(event, 'id') || '', parsed.data)
  if (!organization) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return { organization }
})
