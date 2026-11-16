import { createError, defineEventHandler, getRequestURL, getRouterParam, setResponseHeader } from 'h3'

export default defineEventHandler(async event => {
  const url = getRequestURL(event)
  const id = getRouterParam(event, 'invitationId') || ''
  const version = getRouterParam(event, 'version') || ''
  const expires = url.searchParams.get('expires') || ''
  const signature = url.searchParams.get('signature') || ''
  const asset = url.searchParams.get('asset') || ''
  if (!/^[a-f0-9]{24}$/i.test(id) || !/^[1-9]\d*$/.test(version) ||
    !/^\d{10,11}$/.test(expires) || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !/^[a-f0-9]{16}$/.test(asset) ||
    url.searchParams.getAll('expires').length !== 1 || url.searchParams.getAll('signature').length !== 1 ||
    url.searchParams.getAll('asset').length !== 1 || [...url.searchParams.keys()].length !== 3) {
    throw createError({ statusCode: 404, statusMessage: 'Arte não encontrada' })
  }
  let target: URL
  try {
    const base = new URL(useRuntimeConfig(event).apiInternalUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error()
    target = new URL(`/media/invitations/${id}/${version}`, base)
    target.searchParams.set('expires', expires)
    target.searchParams.set('signature', signature)
    target.searchParams.set('asset', asset)
  } catch { throw createError({ statusCode: 502, statusMessage: 'API indisponível' }) }
  let response: Response
  try { response = await fetch(target, { redirect: 'manual', cache: 'no-store' }) }
  catch { throw createError({ statusCode: 502, statusMessage: 'API indisponível' }) }
  if (!response.ok) throw createError({ statusCode: response.status === 404 ? 404 : 502, statusMessage: 'Arte não encontrada' })
  const data = Buffer.from(await response.arrayBuffer())
  if (data.length > 5 * 1024 * 1024) throw createError({ statusCode: 502, statusMessage: 'Arte indisponível' })
  setResponseHeader(event, 'content-type', 'image/webp')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return data
})
