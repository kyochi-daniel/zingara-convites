import { DeliveryCampaignModel, DeliveryModel } from '@zingara/database'

export async function refreshDeliveryCampaign(id: string) {
  const pending = await DeliveryModel.exists({ campaignId: id, status: { $in: ['queued', 'processing', 'retry_wait', 'uncertain'] } })
  if (!pending) await DeliveryCampaignModel.updateOne({ _id: id, status: { $in: ['running', 'paused'] } }, { $set: { status: 'completed' } })
}
