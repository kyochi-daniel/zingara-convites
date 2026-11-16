import { defineEventHandler } from 'h3'
import { listOrganizations } from '@zingara/core'
import { requireAdmin } from '../../../utils/admin'

export default defineEventHandler(async event => {
  await requireAdmin(event)
  return { items: await listOrganizations() }
})
