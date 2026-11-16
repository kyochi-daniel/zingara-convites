import { createError, defineEventHandler, setResponseStatus } from 'h3'
import { organizationInput } from '@zingara/contracts'
import { createOrganization } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = organizationInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Dados inválidos' })
  setResponseStatus(event, 201)
  return { organization: await createOrganization(parsed.data) }
})
