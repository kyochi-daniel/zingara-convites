import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin'

export default defineEventHandler(async event => {
  const session = await requireAdmin(event)
  return { admin: session.admin, csrfToken: session.csrfToken }
})
