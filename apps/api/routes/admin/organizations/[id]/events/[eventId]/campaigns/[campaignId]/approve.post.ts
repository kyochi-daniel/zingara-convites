import { defineEventHandler } from 'h3'
import { approveDeliveryCampaign } from '@zingara/core/campaigns'
import { readJson } from '../../../../../../../../utils/admin'
import { campaignError, requireCampaignMutation } from '../../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId, campaignId } = await requireCampaignMutation(event)
  const result = await approveDeliveryCampaign(organizationId, eventId, campaignId, await readJson(event))
  if ('error' in result && typeof result.error === 'string') campaignError(result.error)
  return result
})
