import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getPublicInvitation } from '@zingara/core'
import { privateResponse, publicRateLimit } from '../../../utils/public'

export default defineEventHandler(async event => {
  privateResponse(event)
  const token = getRouterParam(event, 'token') || ''
  await publicRateLimit(event, 'read')
  const invitation = await getPublicInvitation(token)
  if (!invitation) throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
  return { invitation }
})
