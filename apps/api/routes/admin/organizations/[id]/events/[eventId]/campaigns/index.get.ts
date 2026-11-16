import { createError, defineEventHandler } from 'h3'
import { listDeliveryCampaigns } from '@zingara/core/campaigns'
import { requireCampaignRead } from '../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId } = await requireCampaignRead(event)
  const result = await listDeliveryCampaigns(organizationId, eventId)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Evento não encontrado' })
  return result
})
