import { defineEventHandler } from 'h3'
import { getDeliveryCampaignPreview } from '@zingara/core/campaigns'
import { campaignError, requireCampaignRead } from '../../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId, campaignId } = await requireCampaignRead(event)
  const result = await getDeliveryCampaignPreview(organizationId, eventId, campaignId)
  if ('error' in result && typeof result.error === 'string') campaignError(result.error)
  return result
})
