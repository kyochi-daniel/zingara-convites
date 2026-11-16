import { createError, defineEventHandler, getRequestURL, getRouterParam, setResponseHeader } from 'h3'
import { readSignedArtwork } from '@zingara/artwork'

export default defineEventHandler(async event => {
  const url = getRequestURL(event)
  const id = getRouterParam(event, 'invitationId') || ''
  const versionText = getRouterParam(event, 'version') || ''
  const expiresText = url.searchParams.get('expires') || ''
  const signature = url.searchParams.get('signature') || ''
  const asset = url.searchParams.get('asset') || ''
  if (!/^[a-f0-9]{24}$/i.test(id) || !/^[1-9]\d*$/.test(versionText) ||
    !/^\d{10,11}$/.test(expiresText) || !/^[A-Za-z0-9_-]{43}$/.test(signature) || !/^[a-f0-9]{16}$/.test(asset) ||
    url.searchParams.getAll('expires').length !== 1 || url.searchParams.getAll('signature').length !== 1 ||
    url.searchParams.getAll('asset').length !== 1 || [...url.searchParams.keys()].length !== 3) {
    throw createError({ statusCode: 404, statusMessage: 'Arte não encontrada' })
  }
  const data = await readSignedArtwork(id, Number(versionText), Number(expiresText), signature, asset)
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Arte não encontrada' })
  setResponseHeader(event, 'content-type', 'image/webp')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return data
})
