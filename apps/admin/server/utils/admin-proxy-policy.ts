type ProxyHeaders = {
  origin?: string
  cookie?: string
  csrfToken?: string
  contentType?: string
}

type HeaderPolicy = {
  mutating: boolean
  csrfRequired: boolean
  cookieAllowed?: boolean
  jsonRequired?: boolean
  imageRequired?: boolean
}

const campaignPath = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/campaigns(?:\/([a-f\d]{24})(?:\/(preview|approve|pause|resume|cancel))?)?$/i
const numberBatchPath = /^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/[a-f\d]{24}\/numbers-(?:preview|verify)$/i

export function adminBodyLimit(route: string) {
  if (/^\/admin\/organizations\/[a-f\d]{24}\/assets$/i.test(route)) return 5 * 1024 * 1024
  if (/^\/admin\/organizations\/[a-f\d]{24}\/guests\/(?:preview|import)$/i.test(route)) return 360_448
  return 16_384
}

export function adminClientIp(remoteAddress: string | undefined, forwardedFor: string | string[] | undefined, trustedProxyIps: string): string {
  const remote = remoteAddress?.replace(/^::ffff:/, '') || ''
  const trusted = new Set(trustedProxyIps.split(',').map(ip => ip.trim().replace(/^::ffff:/, '')).filter(ip => isIP(ip)))
  if (!trusted.has(remote) || typeof forwardedFor !== 'string' || forwardedFor.length > 1024) return remote || 'unknown'
  const hops = forwardedFor.split(',')
  if (hops.length > 16) return remote || 'unknown'
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index]?.trim().replace(/^::ffff:/, '') || ''
    if (!isIP(hop)) return remote || 'unknown'
    if (!trusted.has(hop)) return hop
  }
  return remote || 'unknown'
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 32 || code === 127) return true
  }
  return false
}

export function resolveAdminRoute(pathname: string, method: string, search = ''): string | null {
  if (!pathname.startsWith('/api/admin/')) return null
  const queryStart = pathname.indexOf('?')
  if (queryStart >= 0) {
    if (search) return null
    search = pathname.slice(queryStart)
    pathname = pathname.slice(0, queryStart)
  }
  if (pathname.includes('%')) return null

  const path = pathname.slice('/api'.length)
  const verb = method.toUpperCase()
  const collection = /^\/admin\/organizations\/[a-f\d]{24}\/(events|guests)$/i.test(path)
  const deliveryPreview = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/deliveries\/preview$/i.test(path)
  const automationJobs = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/automations\/jobs$/i.test(path)
  const automationQuery = automationJobs
  let query = ''
  if (search) {
    if (verb !== 'GET' || (!collection && !deliveryPreview && !automationQuery) || !search.startsWith('?')) return null
    const params = new URLSearchParams(search.slice(1))
    const entries = [...params.entries()]
    if (new Set(entries.map(([key]) => key)).size !== entries.length) return null
    const values = Object.fromEntries(entries)
    if (deliveryPreview) {
      const invitationId = values.invitationId
      if (entries.length !== 1 || !invitationId || !/^[a-f\d]{24}$/i.test(invitationId)) return null
      query = `?invitationId=${encodeURIComponent(invitationId)}`
    } else if (automationQuery) {
      const limit = values.limit
      if (entries.length !== 1 || !limit || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) return null
      query = `?limit=${Number(limit)}`
    } else {
      const guestCollection = /\/guests$/i.test(path)
      if (entries.some(([key]) => !['page', 'limit', 'q', ...(guestCollection ? ['tag'] : [])].includes(key))) return null
      if ((values.page !== undefined && (!/^\d+$/.test(values.page) || Number(values.page) < 1 || Number(values.page) > 10_000)) ||
        (values.limit !== undefined && (!/^\d+$/.test(values.limit) || Number(values.limit) < 1 || Number(values.limit) > 100)) ||
        (values.q !== undefined && (values.q.trim().length > 100 || hasControlCharacter(values.q))) ||
        (values.tag !== undefined && (!values.tag.trim() || values.tag.trim().length > 40 || hasControlCharacter(values.tag)))) return null
      const canonical = new URLSearchParams()
      for (const key of ['page', 'limit', 'q', ...(guestCollection ? ['tag'] : [])]) {
        const value = values[key]
        if (value !== undefined && (!['q', 'tag'].includes(key) || value.trim())) {
          canonical.set(key, ['q', 'tag'].includes(key) ? value.trim() : String(Number(value)))
        }
      }
      const encoded = canonical.toString()
      query = encoded ? `?${encoded}` : ''
    }
  }
  const automationType = '(?:initial|pending_reminder|confirmation|receipt|event_change|event_cancellation|admin_summary)'
  const automationBase = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/automations$/i.test(path)
  const automationRule = new RegExp(`^/admin/organizations/[a-f\\d]{24}/events/[a-f\\d]{24}/automations/${automationType}$`).test(path)
  const automationPreview = new RegExp(`^/admin/organizations/[a-f\\d]{24}/events/[a-f\\d]{24}/automations/${automationType}/preview$`).test(path)
  const automationActivate = new RegExp(`^/admin/organizations/[a-f\\d]{24}/events/[a-f\\d]{24}/automations/${automationType}/activate$`).test(path)
  const automationSuppression = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/automations\/guests\/[a-f\d]{24}\/suppress$/i.test(path)
  const publishedEventRevise = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/revise$/i.test(path)
  const publishedEventCancel = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/cancel$/i.test(path)
  const eventReport = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/report$/i.test(path)
  const campaignRoute = campaignPath.exec(path)
  const campaignAction = campaignRoute?.[2]?.toLowerCase()
  const allowed =
    (path === '/admin/auth/login' && verb === 'POST') ||
    (path === '/admin/auth/session' && verb === 'GET') ||
    (path === '/admin/auth/logout' && verb === 'POST') ||
    (path === '/admin/evolution/installation' && verb === 'GET') ||
    (path === '/admin/organizations' && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}$/i.test(path) && ['GET', 'PATCH'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/assistant$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}$/i.test(path) && ['GET', 'PATCH'].includes(verb)) ||
    (publishedEventRevise && verb === 'PUT') ||
    (publishedEventCancel && verb === 'POST') ||
    (eventReport && verb === 'GET') ||
    (campaignRoute !== null && (!campaignRoute[1] ? ['GET', 'POST'].includes(verb)
      : !campaignAction || campaignAction === 'preview' ? verb === 'GET' : verb === 'POST')) ||
    (numberBatchPath.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/template$/i.test(path) && ['GET', 'PUT'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/template\/publish$/i.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/template\/versions\/[1-9]\d*$/i.test(path) && verb === 'GET') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/invitations$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/invitations\/[a-f\d]{24}\/link$/i.test(path) && verb === 'GET') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/invitations\/[a-f\d]{24}\/(rotate|revoke)$/i.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/active$/i.test(path) && ['GET', 'PUT'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/instances$/i.test(path) && verb === 'GET') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/link$/i.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/[a-f\d]{24}$/i.test(path) && verb === 'DELETE') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/[a-f\d]{24}\/status$/i.test(path) && verb === 'GET') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/[a-f\d]{24}\/(connect|number-check|numbers-preview|numbers-verify)$/i.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/[a-f\d]{24}\/templates$/i.test(path) && ['GET', 'PUT'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/deliveries$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (deliveryPreview && verb === 'GET' && query !== '') ||
    (automationBase && verb === 'GET') ||
    (automationRule && verb === 'PUT') ||
    (automationPreview && verb === 'GET') ||
    (automationActivate && verb === 'POST') ||
    (automationJobs && verb === 'GET' && query !== '') ||
    (automationSuppression && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/guests$/i.test(path) && ['GET', 'POST'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/guests\/[a-f\d]{24}$/i.test(path) && ['GET', 'PATCH'].includes(verb)) ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/guests\/(preview|import)$/i.test(path) && verb === 'POST') ||
    (/^\/admin\/organizations\/[a-f\d]{24}\/assets$/i.test(path) && verb === 'POST')

  return allowed ? path + query : null
}

export function buildAdminProxyHeaders(
  input: ProxyHeaders,
  allowedOrigin: string,
  policy: HeaderPolicy,
): Headers | null {
  if (policy.mutating && (!input.origin || input.origin !== allowedOrigin)) return null
  if (policy.csrfRequired && !input.csrfToken) return null
  if ((policy.jsonRequired ?? policy.mutating) && !/^application\/json(?:\s*;|$)/i.test(input.contentType ?? '')) return null
  if (policy.imageRequired && !['image/png', 'image/jpeg', 'image/webp'].includes(input.contentType ?? '')) return null

  const headers = new Headers()
  if (policy.mutating) headers.set('origin', input.origin!)
  if (policy.cookieAllowed !== false && input.cookie) headers.set('cookie', input.cookie)
  if (policy.csrfRequired) headers.set('x-csrf-token', input.csrfToken!)
  if (policy.mutating && input.contentType) headers.set('content-type', input.contentType)
  return headers
}

export function buildAdminProxyTarget(apiInternalUrl: string, route: string): string | null {
  if (!route.startsWith('/admin/') || /#|(?:^|\/)\.\.(?:\/|$)/.test(route)) return null

  try {
    const base = new URL(apiInternalUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      return null
    }
    const target = new URL(route, base)
    const match = /^\/admin\/organizations\/[a-f\d]{24}\/(events|guests)$/i.exec(target.pathname)
    const deliveryPreview = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/deliveries\/preview$/i.test(target.pathname)
    const automationJobs = /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/automations\/jobs$/i.test(target.pathname)
    const automationType = '(?:initial|pending_reminder|confirmation|receipt|event_change|event_cancellation|admin_summary)'
    const automationPath = new RegExp(`^/admin/organizations/[a-f\\d]{24}/events/[a-f\\d]{24}/automations(?:/${automationType}(?:/(?:preview|activate))?|/jobs|/guests/[a-f\\d]{24}/suppress)?$`)
    const allowedPath = target.pathname === '/admin/auth/login' || target.pathname === '/admin/auth/session' ||
      target.pathname === '/admin/auth/logout' || target.pathname === '/admin/organizations' ||
      target.pathname === '/admin/evolution/installation' ||
      /^\/admin\/organizations\/[a-f\d]{24}\/assistant$/i.test(target.pathname) ||
      /^\/admin\/organizations\/[a-f\d]{24}(?:\/events(?:\/[a-f\d]{24}(?:\/(?:revise|cancel|report|template(?:\/(?:publish|versions\/[1-9]\d*))?|invitations(?:\/[a-f\d]{24}\/(?:link|rotate|revoke))?))?)?|\/guests(?:\/(?:[a-f\d]{24}|preview|import))?|\/assets)?$/i.test(target.pathname) ||
      /^\/admin\/organizations\/[a-f\d]{24}\/connections\/(?:active|evolution(?:\/[a-f\d]{24}(?:\/(?:status|connect|number-check|numbers-preview|numbers-verify|templates))?)?)$/i.test(target.pathname) ||
      /^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/link$/i.test(target.pathname) ||
      /^\/admin\/organizations\/[a-f\d]{24}\/connections\/evolution\/instances$/i.test(target.pathname) ||
      /^\/admin\/organizations\/[a-f\d]{24}\/events\/[a-f\d]{24}\/deliveries(?:\/preview)?$/i.test(target.pathname) ||
      automationPath.test(target.pathname) || campaignPath.test(target.pathname) || numberBatchPath.test(target.pathname)
    const entries = [...target.searchParams.entries()]
    const duplicateQuery = new Set(entries.map(([key]) => key)).size !== entries.length
    const guestCollection = match?.[1]?.toLowerCase() === 'guests'
    const collectionQueryValid = match && entries.every(([key, value]) =>
      (key === 'page' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10_000) ||
      (key === 'limit' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100) ||
      (key === 'q' && value.length <= 100 && !hasControlCharacter(value)) ||
      (guestCollection && key === 'tag' && value.trim().length >= 1 && value.trim().length <= 40 && !hasControlCharacter(value)))
    const previewQueryValid = deliveryPreview && entries.length === 1 && entries[0]?.[0] === 'invitationId' && /^[a-f\d]{24}$/i.test(entries[0][1])
    const jobsQueryValid = automationJobs && entries.length === 1 && entries[0]?.[0] === 'limit' && /^\d+$/.test(entries[0][1]) && Number(entries[0][1]) >= 1 && Number(entries[0][1]) <= 50
    if (target.origin !== base.origin || !allowedPath || duplicateQuery ||
      (target.search && !collectionQueryValid && !previewQueryValid && !jobsQueryValid) ||
      (automationJobs && !jobsQueryValid) ||
      (!target.search && entries.length > 0)) return null
    return target.toString()
  } catch {
    return null
  }
}
import { isIP } from 'node:net'
