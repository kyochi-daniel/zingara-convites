import { defineEventHandler } from 'h3'
import { pauseDeliveryCampaign } from '@zingara/core/campaigns'
import { campaignError, requireCampaignMutation } from '../../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId, campaignId } = await requireCampaignMutation(event)
  const result = await pauseDeliveryCampaign(organizationId, eventId, campaignId)
  if ('error' in result && typeof result.error === 'string') campaignError(result.error)
  return result
})
