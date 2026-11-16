import { randomBytes } from 'node:crypto'
import { createError, defineEventHandler, getRequestURL, getRouterParam, setCookie, setResponseHeader, setResponseStatus } from 'h3'
import { invitationTarget, publicClientIp, publicResponseHeaders } from '../../../utils/public-invitation-proxy'

export default defineEventHandler(async event => {
  publicResponseHeaders(event)
  if (getRequestURL(event).search) throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
  const token = getRouterParam(event, 'token') || ''
  const target = invitationTarget(useRuntimeConfig(event).apiInternalUrl, token)
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Convite indisponível' })
  let response: Response
  try {
    response = await fetch(target, {
      headers: { 'x-client-ip': publicClientIp(event.node.req.socket.remoteAddress, event.node.req.headers['x-forwarded-for'], process.env.TRUSTED_PROXY_IPS || '') },
      redirect: 'manual', cache: 'no-store',
    })
  }
  catch { throw createError({ statusCode: 502, statusMessage: 'Convite temporariamente indisponível' }) }
  if (response.status !== 200) {
    throw createError({ statusCode: [404, 429].includes(response.status) ? response.status : 502, statusMessage: 'Convite indisponível' })
  }
  const csrf = randomBytes(16).toString('hex')
  setCookie(event, 'zingara_rsvp_csrf', csrf, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' || getRequestURL(event).protocol === 'https:',
    path: `/api/public/invitations/${token}`, maxAge: 3600,
  })
  setResponseHeader(event, 'x-rsvp-csrf', csrf)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseStatus(event, 200)
  return await response.text()
})
