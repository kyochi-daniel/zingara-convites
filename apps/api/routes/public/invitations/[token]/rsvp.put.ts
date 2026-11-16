import { createError, defineEventHandler, getRouterParam } from 'h3'
import { rsvpInput } from '@zingara/contracts'
import { submitRsvp } from '@zingara/core'
import { privateResponse, publicRateLimit, readPublicJson, requireInviteOrigin } from '../../../../utils/public'

export default defineEventHandler(async event => {
  privateResponse(event)
  requireInviteOrigin(event)
  const token = getRouterParam(event, 'token') || ''
  await publicRateLimit(event, 'write')
  const parsed = rsvpInput.safeParse(await readPublicJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Resposta inválida' })
  const result = await submitRsvp(token, parsed.data)
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
    if (result.error === 'DEADLINE') throw createError({ statusCode: 403, statusMessage: 'Prazo encerrado' })
    if (result.error === 'INVALID_COMPANIONS') throw createError({ statusCode: 400, statusMessage: 'Acompanhantes inválidos' })
    throw createError({ statusCode: 409, statusMessage: 'Resposta alterada; recarregue' })
  }
  return result
})
