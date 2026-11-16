import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getOrganization } from '@zingara/core'
import { requireAdmin } from '../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  const organization = await getOrganization(getRouterParam(event, 'id') || '')
  if (!organization) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return { organization }
})
