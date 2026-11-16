import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { buildMediaTarget } from '../../utils/media-proxy-policy'

export default defineEventHandler(async event => {
  const target = buildMediaTarget(useRuntimeConfig(event).apiInternalUrl, getRouterParam(event, 'assetId') || '')
  if (!target) throw createError({ statusCode: 404, statusMessage: 'Imagem não encontrada' })
  let response: Response
  try { response = await fetch(target, { redirect: 'manual' }) }
  catch { throw createError({ statusCode: 502, statusMessage: 'API indisponível' }) }
  if (!response.ok) throw createError({ statusCode: response.status === 404 ? 404 : 502, statusMessage: 'Imagem não encontrada' })
  setResponseHeader(event, 'content-type', 'image/webp')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return Buffer.from(await response.arrayBuffer())
})
