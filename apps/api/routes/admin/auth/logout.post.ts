import { deleteCookie, defineEventHandler, setResponseStatus } from 'h3'
import { revokeSession } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  await revokeSession(session.sid)
  deleteCookie(event, 'zingara_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' })
  setResponseStatus(event, 204)
  return null
})
