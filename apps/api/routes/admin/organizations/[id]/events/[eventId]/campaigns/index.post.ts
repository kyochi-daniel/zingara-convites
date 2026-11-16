import { defineEventHandler } from 'h3'
import { previewDeliveryCampaign } from '@zingara/core/campaigns'
import { readJson } from '../../../../../../../utils/admin'
import { campaignError, requireCampaignMutation } from '../../../../../../../utils/campaigns'

export default defineEventHandler(async event => {
  const { organizationId, eventId } = await requireCampaignMutation(event)
  const result = await previewDeliveryCampaign(organizationId, eventId, await readJson(event))
  if ('error' in result && typeof result.error === 'string') campaignError(result.error)
  return result
})
