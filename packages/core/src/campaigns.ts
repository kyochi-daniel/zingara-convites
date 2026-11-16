import { createHash } from 'node:crypto'
import { deliveryCampaignActionInput, deliveryCampaignApprovalInput, deliveryCampaignPlanInput,
  type DeliveryCampaignStatus } from '@zingara/contracts'
import { connectDatabase, DeliveryCampaignModel, DeliveryModel, EventModel } from '@zingara/database'
import { approveInitialDelivery, previewInitialDeliveries } from './index.ts'
import { refreshDeliveryCampaign } from './campaign-state.ts'

export const CAMPAIGN_MIN_INTERVAL_MS = 2000
export const CAMPAIGN_MAX_INTERVAL_MS = 3_600_000
export const CAMPAIGN_MAX_RECIPIENTS = 200
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
const record = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object' && !Array.isArray(input)
const scoped = (organizationId: string, eventId: string, id?: string) =>
  [organizationId, eventId, ...(id === undefined ? [] : [id])].every(validId)

function parsePlan(input: unknown) {
  const parsed = deliveryCampaignPlanInput.safeParse(input)
  if (!parsed.success) return null
  const invitationIds = parsed.data.invitationIds.map(id => id.toLowerCase()).sort()
  return { invitationIds, intervalMs: parsed.data.intervalMs,
    scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null }
}

async function buildPreview(organizationId: string, eventId: string, invitationIds: string[], intervalMs: number,
  scheduledAt: Date | null) {
  const result = await previewInitialDeliveries(organizationId, eventId, invitationIds)
  if ('error' in result) return result
  const items = result.previews
  if (items.some(item => !item.recipient.whatsappConsent)) return { error: 'INELIGIBLE' as const }
  if (scheduledAt) {
    const event = await EventModel.findOne({ _id: eventId, organizationId }).select('rsvpDeadline')
    const lastSendAt = new Date(scheduledAt.getTime() + Math.max(0, items.length - 1) * intervalMs)
    const eligibleUntil = Math.min(event?.rsvpDeadline.getTime() ?? 0,
      ...items.map(item => new Date(item.eligibleUntil).getTime()))
    if (!event || lastSendAt.getTime() >= eligibleUntil) return { error: 'INVALID' as const }
  }
  const scheduledAtIso = scheduledAt?.toISOString() ?? null
  const previewHash = createHash('sha256').update(JSON.stringify({ organizationId, eventId, intervalMs,
    scheduledAt: scheduledAtIso,
    items: items.map(item => ({ invitationId: item.invitationId, previewHash: item.previewHash })) })).digest('hex')
  return { preview: { items, intervalMs, scheduledAt: scheduledAtIso, previewHash } }
}

function presentCampaign(doc: any) {
  return { id: doc.id as string, eventId: String(doc.eventId), status: doc.status as DeliveryCampaignStatus,
    intervalMs: doc.intervalMs as number, previewHash: doc.previewHash as string,
    approvedMode: doc.approvedMode as 'fake' | 'real', recipientCount: doc.items.length as number,
    scheduledAt: doc.scheduledAt?.toISOString() as string | undefined ?? null,
    cancelledAt: doc.cancelledAt?.toISOString() as string | undefined ?? null,
    ...(doc.approvalHash ? { approvalHash: doc.approvalHash as string, approvedAt: doc.approvedAt.toISOString() as string } : {}),
    ...(doc.nextSendAt ? { nextSendAt: doc.nextSendAt.toISOString() as string } : {}),
    createdAt: doc.createdAt.toISOString() as string, updatedAt: doc.updatedAt.toISOString() as string }
}

async function suppressUnsentCampaignDeliveries(organizationId: string, eventId: string, id: string) {
  await DeliveryModel.updateMany({ campaignId: id, organizationId, eventId,
    $or: [{ status: { $in: ['queued', 'retry_wait'] } },
      { status: 'processing', 'media.status': { $ne: 'sending' }, 'text.status': { $ne: 'sending' } }] },
  { $set: { status: 'suppressed', suppressionReason: 'campaign_cancelled',
    'media.status': 'skipped', 'text.status': 'suppressed' },
  $unset: { nextAttemptAt: '', leaseUntil: '' } })
}

async function removeInvalidatedCampaignDeliveries(organizationId: string, eventId: string, id: string) {
  if (!await DeliveryCampaignModel.exists({ _id: id, organizationId, eventId,
    status: 'cancelled', cancellationReason: 'invalidated_draft' })) return false
  await DeliveryModel.deleteMany({ campaignId: id, organizationId, eventId,
    status: { $in: ['queued', 'retry_wait', 'suppressed'] }, 'attempts.0': { $exists: false },
    'media.status': { $nin: ['sending', 'accepted'] }, 'text.status': { $nin: ['sending', 'accepted'] } })
  return true
}

async function invalidateDraftCampaign(organizationId: string, eventId: string, id: string) {
  const invalidated = await DeliveryCampaignModel.findOneAndUpdate({ _id: id, organizationId, eventId, status: 'draft' },
    { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'invalidated_draft' } },
  { returnDocument: 'after' })
  await removeInvalidatedCampaignDeliveries(organizationId, eventId, id)
  return Boolean(invalidated)
}

export async function previewDeliveryCampaign(organizationId: string, eventId: string, input: unknown) {
  if (!scoped(organizationId, eventId)) return { error: 'NOT_FOUND' as const }
  const plan = parsePlan(input)
  if (!plan) return { error: 'INVALID' as const }
  if (plan.scheduledAt && plan.scheduledAt <= new Date()) return { error: 'INVALID' as const }
  const result = await buildPreview(organizationId, eventId, plan.invitationIds, plan.intervalMs, plan.scheduledAt)
  if ('error' in result) return result
  await DeliveryCampaignModel.init()
  const filter = { organizationId, eventId, previewHash: result.preview.previewHash }
  let doc
  try {
    doc = await DeliveryCampaignModel.findOneAndUpdate(filter, { $setOnInsert: { ...filter, status: 'draft', intervalMs: plan.intervalMs,
      ...(plan.scheduledAt ? { scheduledAt: plan.scheduledAt } : {}),
      approvedMode: result.preview.items[0]!.mode,
      items: result.preview.items.map(item => ({ invitationId: item.invitationId, previewHash: item.previewHash })) } },
    { upsert: true, returnDocument: 'after', runValidators: true })
  } catch (error) {
    if (!record(error) || error.code !== 11000) throw error
    doc = await DeliveryCampaignModel.findOne(filter)
  }
  return { campaign: presentCampaign(doc), preview: result.preview }
}

export async function getDeliveryCampaignPreview(organizationId: string, eventId: string, id: string) {
  if (!scoped(organizationId, eventId, id)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const doc = await DeliveryCampaignModel.findOne({ _id: id, organizationId, eventId })
  if (!doc) return { error: 'NOT_FOUND' as const }
  const result = await buildPreview(organizationId, eventId, doc.items.map((item: any) => String(item.invitationId)),
    doc.intervalMs, doc.scheduledAt ?? null)
  if ('error' in result || result.preview.previewHash !== doc.previewHash) return { error: 'CONFLICT' as const }
  return { campaign: presentCampaign(doc), preview: result.preview }
}

export async function approveDeliveryCampaign(organizationId: string, eventId: string, id: string, input: unknown) {
  if (!scoped(organizationId, eventId, id)) return { error: 'NOT_FOUND' as const }
  const parsed = deliveryCampaignApprovalInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  await connectDatabase()
  await DeliveryCampaignModel.init()
  await DeliveryModel.init()
  const filter = { _id: id, organizationId, eventId }
  const doc = await DeliveryCampaignModel.findOne(filter)
  if (!doc) return { error: 'NOT_FOUND' as const }
  if (doc.status === 'cancelled' && doc.cancellationReason === 'invalidated_draft') {
    await removeInvalidatedCampaignDeliveries(organizationId, eventId, id)
    return { error: 'CONFLICT' as const }
  }
  if (doc.previewHash !== parsed.data.previewHash) return { error: 'CONFLICT' as const }
  if (doc.approvalHash === parsed.data.previewHash) return { campaign: presentCampaign(doc) }
  if (doc.status !== 'draft') return { error: 'CONFLICT' as const }
  if (doc.scheduledAt && doc.scheduledAt <= new Date()) {
    await invalidateDraftCampaign(organizationId, eventId, id)
    return { error: 'CONFLICT' as const }
  }
  const preview = await buildPreview(organizationId, eventId, doc.items.map((item: any) => String(item.invitationId)),
    doc.intervalMs, doc.scheduledAt ?? null)
  if ('error' in preview || preview.preview.previewHash !== parsed.data.previewHash) return { error: 'CONFLICT' as const }
  // Draft rows survive partial failures but cannot dispatch until the whole plan is approved.
  for (const item of doc.items) {
    const result = await approveInitialDelivery(organizationId, eventId,
      { invitationId: String(item.invitationId), approve: true, previewHash: item.previewHash }, { campaignId: id })
    if ('error' in result) {
      const current = await DeliveryCampaignModel.findOne(filter).select('status cancellationReason')
      if (current?.status === 'cancelled' && current.cancellationReason !== 'invalidated_draft') {
        await suppressUnsentCampaignDeliveries(organizationId, eventId, id)
      } else if (current?.status === 'cancelled') {
        await removeInvalidatedCampaignDeliveries(organizationId, eventId, id)
      } else await invalidateDraftCampaign(organizationId, eventId, id)
      return { error: 'CONFLICT' as const }
    }
  }
  const latest = await buildPreview(organizationId, eventId, doc.items.map((item: any) => String(item.invitationId)),
    doc.intervalMs, doc.scheduledAt ?? null)
  if ('error' in latest || latest.preview.previewHash !== parsed.data.previewHash ||
    (doc.scheduledAt && doc.scheduledAt <= new Date())) {
    await invalidateDraftCampaign(organizationId, eventId, id)
    return { error: 'CONFLICT' as const }
  }
  const transition = await DeliveryCampaignModel.updateOne({ ...filter, status: 'draft', previewHash: parsed.data.previewHash },
    { $set: { status: doc.scheduledAt ? 'scheduled' : 'running', approvalHash: parsed.data.previewHash, approvedAt: new Date() } })
  const current = await DeliveryCampaignModel.findOne(filter)
  if (!transition.modifiedCount) {
    if (current?.approvalHash === parsed.data.previewHash && ['scheduled', 'running'].includes(current.status)) {
      return { campaign: presentCampaign(current) }
    }
    if (current?.status === 'cancelled' && current.cancellationReason === 'invalidated_draft') {
      await removeInvalidatedCampaignDeliveries(organizationId, eventId, id)
    } else if (current?.status === 'cancelled') await suppressUnsentCampaignDeliveries(organizationId, eventId, id)
    return { error: 'CONFLICT' as const }
  }
  return { campaign: presentCampaign(current) }
}

export async function getDeliveryCampaign(organizationId: string, eventId: string, id: string) {
  if (!scoped(organizationId, eventId, id)) return null
  await connectDatabase()
  let doc = await DeliveryCampaignModel.findOne({ _id: id, organizationId, eventId })
  if (!doc) return null
  if (doc.approvalHash) {
    await refreshDeliveryCampaign(id)
    doc = await DeliveryCampaignModel.findOne({ _id: id, organizationId, eventId })
  }
  const deliveries = await DeliveryModel.find({ campaignId: id, organizationId, eventId }).select('invitationId status media.status text.status')
  const counts = { queued: 0, processing: 0, retry_wait: 0, uncertain: 0, suppressed: 0, completed: 0, failed_permanent: 0 }
  for (const delivery of deliveries) counts[delivery.status as keyof typeof counts]++
  return { campaign: { ...presentCampaign(doc), counts, items: deliveries.map(delivery => ({
    deliveryId: delivery.id as string, invitationId: String(delivery.invitationId), status: delivery.status as string,
    mediaStatus: delivery.media.status as string, textStatus: delivery.text.status as string,
  })) } }
}

export async function listDeliveryCampaigns(organizationId: string, eventId: string) {
  if (!scoped(organizationId, eventId)) return null
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return null
  const docs = await DeliveryCampaignModel.find({ organizationId, eventId }).sort({ createdAt: -1, _id: -1 }).limit(100)
  return { items: docs.map(presentCampaign) }
}

async function changeCampaignState(organizationId: string, eventId: string, id: string, pause: boolean) {
  if (!scoped(organizationId, eventId, id)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const filter = { _id: id, organizationId, eventId }
  const status = pause ? 'paused' : 'running'
  const doc = await DeliveryCampaignModel.findOneAndUpdate({ ...filter, status: pause ? 'running' : 'paused',
    approvalHash: { $exists: true }, $expr: { $eq: ['$previewHash', '$approvalHash'] } },
  pause ? { $set: { status, pausedAt: new Date() } } : { $set: { status }, $unset: { pausedAt: '' } }, { returnDocument: 'after' })
  if (doc) return { campaign: presentCampaign(doc) }
  const current = await DeliveryCampaignModel.findOne(filter)
  return current?.status === status ? { campaign: presentCampaign(current) } :
    { error: current ? 'CONFLICT' as const : 'NOT_FOUND' as const }
}

export const pauseDeliveryCampaign = (organizationId: string, eventId: string, id: string) => changeCampaignState(organizationId, eventId, id, true)
export const resumeDeliveryCampaign = (organizationId: string, eventId: string, id: string) => changeCampaignState(organizationId, eventId, id, false)

export async function cancelDeliveryCampaign(organizationId: string, eventId: string, id: string, input: unknown = {}) {
  if (!scoped(organizationId, eventId, id)) return { error: 'NOT_FOUND' as const }
  if (!deliveryCampaignActionInput.safeParse(input).success) return { error: 'INVALID' as const }
  await connectDatabase()
  const filter = { _id: id, organizationId, eventId }
  const cancelledAt = new Date()
  let doc = await DeliveryCampaignModel.findOneAndUpdate({ ...filter,
    status: { $in: ['draft', 'scheduled', 'running', 'paused'] } },
  { $set: { status: 'cancelled', cancelledAt, cancellationReason: 'user' },
    $unset: { pausedAt: '', nextSendAt: '' } }, { returnDocument: 'after' })
  if (!doc) {
    doc = await DeliveryCampaignModel.findOne(filter)
    if (!doc) return { error: 'NOT_FOUND' as const }
    if (doc.status !== 'cancelled') return { error: 'CONFLICT' as const }
  }
  await suppressUnsentCampaignDeliveries(organizationId, eventId, id)
  return { campaign: presentCampaign(doc) }
}
