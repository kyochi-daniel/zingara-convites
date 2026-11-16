import { createError, defineEventHandler, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { deliveryApprovalInput } from '@zingara/contracts'
import { approveInitialDelivery } from '@zingara/core'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = deliveryApprovalInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Aprovação inválida' })
  const result = await approveInitialDelivery(getRouterParam(event, 'id') || '', getRouterParam(event, 'eventId') || '', parsed.data)
  if ('error' in result) {
    if (result.error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Convite não encontrado' })
    throw createError({ statusCode: 409, statusMessage: 'Prévia desatualizada ou envio indisponível' })
  }
  setResponseStatus(event, result.created ? 201 : 200)
  return { delivery: result.delivery }
})
