import { createError, defineEventHandler } from 'h3'
import { getDeliveryCampaign } from '@zingara/core/campaigns'
import { requireCampaignRead } from '../../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId, campaignId } = await requireCampaignRead(event)
  const result = await getDeliveryCampaign(organizationId, eventId, campaignId)
  if (!result) throw createError({ statusCode: 404, statusMessage: 'Campanha não encontrada' })
  return result
})
