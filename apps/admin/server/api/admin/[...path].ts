import {
  appendResponseHeader,
  createError,
  defineEventHandler,
  getRequestHeader,
  getRequestURL,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
import {
  adminClientIp,
  adminBodyLimit,
  buildAdminProxyHeaders,
  buildAdminProxyTarget,
  resolveAdminRoute,
} from '../../utils/admin-proxy-policy'

export default defineEventHandler(async (event) => {
  const requestUrl = getRequestURL(event)
  const method = event.method ?? 'GET'
  const route = resolveAdminRoute(requestUrl.pathname, method, requestUrl.search)
  if (!route) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const login = route === '/admin/auth/login'
  const assetUpload = /^\/admin\/organizations\/[a-f\d]{24}\/assets$/i.test(route)
  const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
  const csrfRequired = mutating && !login
  const config = useRuntimeConfig(event)
  const expectedOrigin = config.adminOrigin || requestUrl.origin
  const headers = buildAdminProxyHeaders({
    origin: getRequestHeader(event, 'origin'),
    cookie: getRequestHeader(event, 'cookie'),
    csrfToken: getRequestHeader(event, 'x-csrf-token'),
    contentType: getRequestHeader(event, 'content-type'),
  }, expectedOrigin, {
    mutating, csrfRequired, cookieAllowed: !login,
    jsonRequired: mutating && method !== 'DELETE' && route !== '/admin/auth/logout' && !assetUpload,
    imageRequired: assetUpload,
  })
  if (!headers) {
    throw createError({ statusCode: 403, statusMessage: 'Request rejected' })
  }
  if (login) headers.set('x-client-ip', adminClientIp(event.node.req.socket.remoteAddress,
    event.node.req.headers['x-forwarded-for'], process.env.TRUSTED_PROXY_IPS || ''))

  const target = buildAdminProxyTarget(config.apiInternalUrl, route)
  if (!target) {
    throw createError({ statusCode: 500, statusMessage: 'Admin API is not configured' })
  }

  let body: string | Uint8Array<ArrayBuffer> | undefined
  if (mutating) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of event.node.req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > adminBodyLimit(route)) {
        throw createError({ statusCode: 413, statusMessage: 'Request too large' })
      }
      chunks.push(buffer)
    }
    const content = Buffer.concat(chunks)
    body = assetUpload ? new Uint8Array(content) : content.toString('utf8')
  }

  try {
    const response = await fetch(target, { method, headers, body, redirect: 'manual' })
    setResponseStatus(event, response.status)
    setResponseHeader(event, 'cache-control', 'no-store')
    const contentType = response.headers.get('content-type')
    if (contentType) setResponseHeader(event, 'content-type', contentType)
    for (const cookie of response.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
    return response.status === 204 ? undefined : await response.text()
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Admin API unavailable' })
  }
})
