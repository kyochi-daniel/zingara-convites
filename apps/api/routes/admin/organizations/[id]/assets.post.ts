import { createError, defineEventHandler, getHeader, getRouterParam, setResponseStatus } from 'h3'
import { getOrganization } from '@zingara/core'
import { MAX_ASSET_BYTES, storeAsset } from '../../../../utils/assets'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../utils/admin'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const organization = await getOrganization(getRouterParam(event, 'id') || '')
  if (!organization) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  const contentType = getHeader(event, 'content-type') || ''
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
    throw createError({ statusCode: 415, statusMessage: 'Tipo de imagem não aceito' })
  }
  const length = Number(getHeader(event, 'content-length'))
  if (length > MAX_ASSET_BYTES) throw createError({ statusCode: 413, statusMessage: 'Imagem muito grande' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_ASSET_BYTES) throw createError({ statusCode: 413, statusMessage: 'Imagem muito grande' })
    chunks.push(buffer)
  }
  const asset = await storeAsset(organization.id, Buffer.concat(chunks), contentType)
  setResponseStatus(event, 201)
  return { asset }
})
