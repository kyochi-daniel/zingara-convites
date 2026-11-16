import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { getOrganization, readActiveConnection } from '@zingara/core'
import { requireAdmin } from '../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  const organizationId = getRouterParam(event, 'id') || ''
  if (!await getOrganization(organizationId)) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return { active: await readActiveConnection(organizationId) }
})
