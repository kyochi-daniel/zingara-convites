import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3'
import { readAsset } from '../../utils/assets'

export default defineEventHandler(async event => {
  const data = await readAsset(getRouterParam(event, 'assetId') || '')
  if (!data) throw createError({ statusCode: 404, statusMessage: 'Imagem não encontrada' })
  setResponseHeader(event, 'content-type', 'image/webp')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  setResponseHeader(event, 'cache-control', 'public, max-age=31536000, immutable')
  return data
})
