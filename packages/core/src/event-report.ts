import type { EventReport } from '@zingara/contracts'
import {
  connectDatabase,
  DeliveryModel,
  EventModel,
  GuestModel,
  InvitationModel,
} from '@zingara/database'

const TEST_GUEST_TAG = 'teste-zingara'
const objectIdPattern = /^[0-9a-f]{24}$/i
const receiptRanks: Record<string, number> = {
  pending: 0,
  unknown: 0,
  server_ack: 1,
  sent: 1,
  delivery_ack: 2,
  delivered: 2,
  read_ack: 3,
  read: 3,
  played: 4,
}

type ReportInvitation = {
  _id: unknown
  guestId: unknown
  responseStatus: 'pending' | 'accepted' | 'declined'
  companions: string[]
  revokedAt?: Date
}

type ReportGuest = {
  _id: unknown
  name: string
  phone: string
  tags?: string[]
}

type MessageDelivery = {
  invitationId?: unknown
  guestId?: unknown
  text?: {
    status?: string
    receiptStatus?: string
    receiptRank?: number
  }
}

function deliveryReceiptRank(delivery: MessageDelivery) {
  const storedRank = Number.isInteger(delivery.text?.receiptRank)
    ? Math.max(0, Math.min(4, delivery.text!.receiptRank!))
    : 0
  const namedRank = receiptRanks[String(delivery.text?.receiptStatus ?? '').toLowerCase()] ?? 0
  return Math.max(storedRank, namedRank)
}

export function summarizeEventMessages(deliveries: MessageDelivery[]) {
  const byInvitation = new Map<string, { accepted: boolean; receiptRank: number; failed: boolean }>()
  for (const delivery of deliveries) {
    const invitationId = String(delivery.invitationId ?? '')
    if (!objectIdPattern.test(invitationId)) continue
    const current = byInvitation.get(invitationId) ?? { accepted: false, receiptRank: 0, failed: false }
    const rank = deliveryReceiptRank(delivery)
    current.receiptRank = Math.max(current.receiptRank, rank)
    current.accepted ||= delivery.text?.status === 'accepted' || rank >= 1
    current.failed ||= delivery.text?.status === 'failed_permanent'
    byInvitation.set(invitationId, current)
  }

  const messages: EventReport['messages'] = {
    total: byInvitation.size,
    accepted: 0,
    delivered: 0,
    read: 0,
    awaitingDelivery: 0,
    failed: 0,
  }
  for (const state of byInvitation.values()) {
    if (state.accepted) messages.accepted++
    if (state.receiptRank >= 2) messages.delivered++
    if (state.receiptRank >= 3) messages.read++
    const failed = state.failed && !state.accepted && state.receiptRank === 0
    if (failed) messages.failed++
    else if (state.receiptRank < 2) messages.awaitingDelivery++
  }
  return messages
}

export async function getEventReport(organizationId: string, eventId: string): Promise<EventReport | null> {
  if (!objectIdPattern.test(organizationId) || !objectIdPattern.test(eventId)) return null
  await connectDatabase()
  const event = await EventModel.findOne({ _id: eventId, organizationId }).select('name').lean()
  if (!event) return null

  const invitations = await InvitationModel.find({ organizationId, eventId })
    .select('_id guestId responseStatus companions revokedAt').lean() as ReportInvitation[]
  const guests = await GuestModel.find({
    _id: { $in: invitations.map(invitation => invitation.guestId) },
    organizationId,
  }).select('_id name phone tags').lean() as ReportGuest[]
  const guestsById = new Map(guests
    .filter(guest => !(guest.tags ?? []).includes(TEST_GUEST_TAG))
    .map(guest => [String(guest._id), guest]))
  const eligibleInvitations = invitations.filter(invitation => guestsById.has(String(invitation.guestId)))
  const invitationsById = new Map(eligibleInvitations.map(invitation => [String(invitation._id), invitation]))

  const rsvp: EventReport['rsvp'] = {
    pending: 0,
    accepted: 0,
    declined: 0,
    revoked: 0,
    peopleConfirmed: 0,
  }
  const confirmed: EventReport['confirmed'] = []
  for (const invitation of eligibleInvitations) {
    if (invitation.revokedAt) {
      rsvp.revoked++
      continue
    }
    rsvp[invitation.responseStatus]++
    if (invitation.responseStatus !== 'accepted') continue
    const guest = guestsById.get(String(invitation.guestId))!
    const peopleCount = 1 + invitation.companions.length
    rsvp.peopleConfirmed += peopleCount
    confirmed.push({
      invitationId: String(invitation._id),
      guestId: String(guest._id),
      name: guest.name,
      phone: guest.phone,
      peopleCount,
    })
  }
  confirmed.sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }) ||
    left.name.localeCompare(right.name, 'pt-BR') || left.invitationId.localeCompare(right.invitationId))

  const deliveries = await DeliveryModel.find({
    organizationId,
    eventId,
    type: 'initial',
    approvedMode: 'real',
    invitationId: { $in: eligibleInvitations.map(invitation => invitation._id) },
  }).select('invitationId guestId text.status text.receiptStatus text.receiptRank').lean() as MessageDelivery[]
  const scopedDeliveries = deliveries.filter(delivery => {
    const invitation = invitationsById.get(String(delivery.invitationId ?? ''))
    return invitation && String(delivery.guestId ?? '') === String(invitation.guestId)
  })

  return {
    eventId: String(event._id),
    eventName: event.name as string,
    generatedAt: new Date().toISOString(),
    messages: summarizeEventMessages(scopedDeliveries),
    rsvp,
    confirmed,
  }
}
