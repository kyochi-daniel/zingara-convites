import { createError, defineEventHandler, getRequestURL, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { invitationTarget, publicClientIp, publicResponseHeaders, readPublicJson, requirePublicMutation } from '../../../../utils/public-invitation-proxy'

export default defineEventHandler(async event => {
  publicResponseHeaders(event)
  const token = getRouterParam(event, 'token') || ''
  const target = invitationTarget(useRuntimeConfig(event).apiInternalUrl, token, true)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
  const expectedOrigin = useRuntimeConfig(event).inviteOrigin || getRequestURL(event).origin
  requirePublicMutation(event, token, expectedOrigin)
  const body = await readPublicJson(event)
  let response: Response
  try {
    response = await fetch(target, {
      method: 'PUT', headers: {
        origin: expectedOrigin, 'content-type': 'application/json',
        'x-client-ip': publicClientIp(event.node.req.socket.remoteAddress, event.node.req.headers['x-forwarded-for'], process.env.TRUSTED_PROXY_IPS || ''),
      },
      body, redirect: 'manual', cache: 'no-store',
    })
  } catch { throw createError({ statusCode: 502, statusMessage: 'Resposta temporariamente indisponível' }) }
  if (![200, 400, 403, 404, 409, 429].includes(response.status)) {
    throw createError({ statusCode: 502, statusMessage: 'Resposta temporariamente indisponível' })
  }
  setResponseStatus(event, response.status)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  return await response.text()
})
