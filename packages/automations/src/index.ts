import { createHash } from 'node:crypto'
import mongoose from 'mongoose'
import { z } from 'zod'
import { connectDatabase, DeliveryModel, EventModel, GuestModel, InvitationModel } from '@zingara/database'
import { activeConnectionIdentity, approvedEvolutionTemplate, approveInitialDelivery, getInvitationLink, hasGuestWhatsAppConsent, previewInitialDelivery } from '@zingara/core'
import { resolveTemplateText } from '@zingara/contracts'

const { Schema, model, models } = mongoose
const scheduleSchema = new Schema({ anchor: { type: String, required: true },
  offsetMinutes: { type: Number, required: true }, at: String }, { _id: false })
const ruleSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, required: true }, enabled: { type: Boolean, required: true },
  audience: { type: String, required: true }, schedule: { type: scheduleSchema, required: true },
  text: { type: String, required: true }, maxExecutions: { type: Number, required: true },
  graceMinutes: { type: Number, required: true }, revision: { type: Number, required: true, default: 1 },
  activatedRevision: Number, activatedAt: Date, activationEventVersion: Number,
  activationEventUpdatedAt: Date, activatedConnectionId: Schema.Types.ObjectId,
  activatedConnectionServerUrl: String, activatedConnectionTokenHash: String,
  activatedProvider: String, activatedChannel: String, activatedConnectionRevision: Number,
  activatedTemplateName: String, activatedTemplateLanguage: String, activatedTemplateRevision: Number,
  activatedMode: { type: String, enum: ['fake', 'real'] },
}, { timestamps: true, versionKey: false })
ruleSchema.index({ organizationId: 1, eventId: 1, type: 1 }, { unique: true })
const AutomationRuleModel = models.AutomationRule || model('AutomationRule', ruleSchema)

const ID = /^[a-f0-9]{24}$/i
const PHONE = /^\+[1-9]\d{7,14}$/
export const automationTypes = ['initial', 'pending_reminder', 'confirmation', 'receipt', 'event_change', 'event_cancellation', 'admin_summary'] as const
export type AutomationType = typeof automationTypes[number]
const typeSchema = z.enum(automationTypes)
const audiences = ['all', 'pending', 'accepted', 'declined', 'admin'] as const
const anchors = ['activation', 'event_start', 'rsvp_deadline', 'rsvp_update', 'event_update', 'event_cancelled', 'fixed'] as const
const allowed: Record<AutomationType, { audiences: readonly string[]; anchors: readonly string[] }> = {
  initial: { audiences: ['pending'], anchors: ['activation', 'fixed'] },
  pending_reminder: { audiences: ['pending'], anchors: ['rsvp_deadline', 'fixed'] },
  confirmation: { audiences: ['accepted'], anchors: ['event_start', 'fixed'] },
  receipt: { audiences: ['accepted'], anchors: ['rsvp_update'] },
  event_change: { audiences: ['all', 'pending', 'accepted', 'declined'], anchors: ['event_update'] },
  event_cancellation: { audiences: ['all', 'pending', 'accepted', 'declined'], anchors: ['event_cancelled'] },
  admin_summary: { audiences: ['admin'], anchors: ['event_start', 'fixed'] },
}
const variables = new Set(['convidado.nome', 'evento.nome', 'evento.data', 'evento.horario', 'evento.local',
  'convite.link', 'convite.limite_acompanhantes', 'resumo.pendentes', 'resumo.confirmados', 'resumo.recusados'])
const textSchema = z.string().trim().min(1).max(1000).refine(text =>
  !/<\s*\/?\s*[a-z][^>]*>/i.test(text) &&
  [...text.matchAll(/\{\{([^{}]*)\}\}/g)].every(match => variables.has(match[1]?.trim() || '')) &&
  !text.replace(/\{\{[^{}]*\}\}/g, '').includes('{{') &&
  !text.replace(/\{\{[^{}]*\}\}/g, '').includes('}}'), 'Texto ou variável inválida')
export const ruleInput = z.object({
  enabled: z.boolean(),
  audience: z.enum(audiences),
  schedule: z.object({ anchor: z.enum(anchors), offsetMinutes: z.number().int().min(-43200).max(43200),
    at: z.iso.datetime({ offset: true }).optional() }).strict(),
  text: textSchema,
  maxExecutions: z.number().int().min(1).max(10),
  graceMinutes: z.number().int().min(5).max(1440),
  expectedRevision: z.number().int().min(0),
}).strict()
export const activationInput = z.object({ expectedRevision: z.number().int().min(1), previewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const suppressionInput = z.object({ reason: z.string().trim().min(1).max(200) }).strict()
export type RuleInput = z.infer<typeof ruleInput>

function validScope(organizationId: string, eventId: string): boolean { return ID.test(organizationId) && ID.test(eventId) }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function activationMatches(rule: any, identity: NonNullable<Awaited<ReturnType<typeof activeConnectionIdentity>>>): boolean {
  return String(rule.activatedConnectionId || '') === String(identity.approvedConnectionId) &&
    rule.activatedConnectionServerUrl === identity.approvedConnectionServerUrl &&
    rule.activatedConnectionTokenHash === identity.approvedConnectionTokenHash &&
    rule.activatedMode === identity.approvedMode &&
    (rule.activatedProvider || 'uazapigo') === identity.approvedProvider &&
    (rule.activatedConnectionRevision || 0) === identity.approvedConnectionRevision
}
function isDuplicate(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 11000 }
function presentRule(doc: any) {
  return { id: String(doc._id), type: doc.type as AutomationType, enabled: doc.enabled as boolean,
    audience: doc.audience as string, schedule: { anchor: doc.schedule.anchor as string,
      offsetMinutes: doc.schedule.offsetMinutes as number, ...(doc.schedule.at ? { at: doc.schedule.at as string } : {}) },
    text: doc.text as string, maxExecutions: doc.maxExecutions as number, graceMinutes: doc.graceMinutes as number,
    revision: doc.revision as number, activatedRevision: (doc.activatedRevision ?? null) as number | null,
    updatedAt: doc.updatedAt.toISOString() as string }
}
function validRuleForType(type: AutomationType, input: RuleInput): boolean {
  return allowed[type].audiences.includes(input.audience) && allowed[type].anchors.includes(input.schedule.anchor) &&
    (input.schedule.anchor === 'fixed' ? !!input.schedule.at : !input.schedule.at) &&
    (type !== 'initial' || input.maxExecutions === 1) &&
    (type === 'admin_summary' || !/\{\{resumo\./.test(input.text))
}

export async function listRules(organizationId: string, eventId: string) {
  if (!validScope(organizationId, eventId)) return null
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return null
  const docs = await AutomationRuleModel.find({ organizationId, eventId }).sort({ type: 1 })
  return { rules: docs.map(presentRule) }
}

export async function saveRule(organizationId: string, eventId: string, rawType: string, input: unknown) {
  const parsedType = typeSchema.safeParse(rawType)
  const parsed = ruleInput.safeParse(input)
  if (!parsedType.success || !parsed.success || !validScope(organizationId, eventId) ||
    !validRuleForType(parsedType.data, parsed.data)) return { error: 'INVALID' as const }
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return { error: 'NOT_FOUND' as const }
  const { expectedRevision, ...fields } = parsed.data
  await AutomationRuleModel.init()
  if (expectedRevision === 0) {
    try {
      const doc = await AutomationRuleModel.create({ organizationId, eventId, type: parsedType.data, ...fields, revision: 1 })
      return { rule: presentRule(doc) }
    } catch (error) { if (isDuplicate(error)) return { error: 'CONFLICT' as const }; throw error }
  }
  const doc = await AutomationRuleModel.findOneAndUpdate({ organizationId, eventId, type: parsedType.data, revision: expectedRevision },
    { $set: { ...fields, activatedRevision: null },
      $unset: { activatedConnectionId: '', activatedConnectionServerUrl: '', activatedConnectionTokenHash: '', activatedMode: '' },
      $inc: { revision: 1 } }, { returnDocument: 'after' })
  return doc ? { rule: presentRule(doc) } : { error: 'CONFLICT' as const }
}

function audienceMatches(audience: string, responseStatus: string): boolean {
  return audience === 'all' || audience === responseStatus
}
function adminRecipient(): string | null {
  const phone = process.env.ADMIN_SUMMARY_PHONE || ''
  return process.env.ADMIN_SUMMARY_CONSENT === '1' && PHONE.test(phone) ? phone : null
}
function scheduledAt(rule: any, event: any, invitation: any, now = new Date()): Date | null {
  let anchor: Date | null = null
  switch (rule.schedule.anchor) {
    case 'activation': anchor = rule.activatedAt || now; break
    case 'event_start': anchor = event.startsAt; break
    case 'rsvp_deadline': anchor = event.rsvpDeadline; break
    case 'rsvp_update': anchor = invitation?.respondedAt || null; break
    case 'event_update': anchor = event.updatedAt; break
    case 'event_cancelled': anchor = event.cancelledAt || null; break
    case 'fixed': anchor = new Date(rule.schedule.at); break
  }
  return anchor && !Number.isNaN(anchor.getTime()) ? new Date(anchor.getTime() + rule.schedule.offsetMinutes * 60_000) : null
}
function occurrence(rule: any, event: any, invitation: any): string {
  if (rule.type === 'receipt') return `rsvp-${invitation.responseVersion}`
  if (rule.type === 'event_change') return `change-${event.changeVersion || 0}`
  if (rule.type === 'event_cancellation') return `cancel-${event.cancelledAt?.getTime() || 0}`
  if (rule.type === 'admin_summary') return `summary-${event.publishedTemplateVersion}`
  return 'once'
}
function eventAllows(rule: any, event: any): boolean {
  if (rule.type === 'event_cancellation') return event.status === 'cancelled' && !!event.cancelledAt
  if (rule.type === 'event_change') return event.status === 'published' && (event.changeVersion || 0) > (rule.activationEventVersion || 0)
  return event.status === 'published'
}
function invitationUsable(rule: any, event: any, invitation: any, now: Date): boolean {
  if (rule.type === 'event_cancellation') {
    return !!event.cancelledAt && (!invitation.revokedAt ||
      invitation.revokedAt.getTime() === event.cancelledAt.getTime())
  }
  return !invitation.revokedAt && Math.min(invitation.expiresAt.getTime(), event.endsAt.getTime()) > now.getTime()
}

type Candidate = { invitation: any; guest: any; due: Date | null; reason?: string }
async function candidates(rule: any, event: any): Promise<Candidate[]> {
  if (rule.type === 'admin_summary') return []
  const invitations = await InvitationModel.find({ organizationId: rule.organizationId, eventId: rule.eventId }).limit(1001)
  if (invitations.length > 1000) throw new Error('Evento excede limite de planejamento')
  const guests = await GuestModel.find({ organizationId: rule.organizationId, _id: { $in: invitations.map(doc => doc.guestId) } })
  const byId = new Map(guests.map(doc => [String(doc._id), doc]))
  const now = new Date()
  return invitations.map(invitation => {
    const guest = byId.get(String(invitation.guestId))
    const due = scheduledAt(rule, event, invitation, now)
    let reason: string | undefined
    if (!guest) reason = 'guest_missing'
    else if (!hasGuestWhatsAppConsent(guest)) reason = 'no_consent'
    else if (guest.whatsappOptedOutAt) reason = 'opt_out'
    else if (!invitationUsable(rule, event, invitation, now)) reason = 'invitation_inactive'
    else if (!audienceMatches(rule.audience, invitation.responseStatus)) reason = 'rsvp_changed'
    else if (!due) reason = 'trigger_pending'
    else if (rule.type === 'pending_reminder' && event.rsvpDeadline <= now) reason = 'deadline_passed'
    return { invitation, guest, due, reason }
  })
}

export async function previewRule(organizationId: string, eventId: string, rawType: string) {
  const parsedType = typeSchema.safeParse(rawType)
  if (!parsedType.success || !validScope(organizationId, eventId)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const [rule, event, connection] = await Promise.all([
    AutomationRuleModel.findOne({ organizationId, eventId, type: parsedType.data }),
    EventModel.findOne({ _id: eventId, organizationId }),
    activeConnectionIdentity(organizationId),
  ])
  if (!rule || !event) return { error: 'NOT_FOUND' as const }
  const officialTemplate = connection?.approvedChannel === 'cloud'
    ? await approvedEvolutionTemplate(organizationId, String(connection.approvedConnectionId), parsedType.data) : null
  if (connection?.approvedChannel === 'cloud' && !officialTemplate) return { error: 'NO_TEMPLATE' as const }
  const deliveryContent = officialTemplate
    ? { kind: 'official_template' as const, name: officialTemplate.name, language: officialTemplate.language,
      variables: officialTemplate.variables, textUsed: false }
    : { kind: 'free_text' as const, textUsed: true }
  const rows = await candidates(rule, event)
  const adminPhone = rule.type === 'admin_summary' ? adminRecipient() : null
  const sample = rule.type === 'admin_summary'
    ? [{ invitationId: '', guestName: 'Administrador', phone: adminPhone || '', responseStatus: 'admin',
      scheduledAt: scheduledAt(rule, event, null)?.toISOString() || '', eligible: !!adminPhone && !!connection,
      ...(!adminPhone ? { reason: 'admin_not_configured' } : !connection ? { reason: 'no_connection' } : {}) }]
    : rows.slice(0, 20).map(row => ({ invitationId: String(row.invitation._id), guestName: row.guest?.name || '',
      phone: row.guest?.phone || '', responseStatus: row.invitation.responseStatus as string,
      scheduledAt: row.due?.toISOString() || '', eligible: !row.reason && !!connection,
      ...(row.reason || !connection ? { reason: row.reason || 'no_connection' } : {}) }))
  const recipientCount = rule.type === 'admin_summary' ? Number(!!adminPhone && !!connection)
    : connection ? rows.filter(row => !row.reason).length : 0
  const previewHash = hash({ rule: String(rule._id), revision: rule.revision, enabled: rule.enabled,
    audience: rule.audience, schedule: rule.schedule.toObject(), text: rule.text,
    eventVersion: event.publishedTemplateVersion, changeVersion: event.changeVersion, eventUpdatedAt: event.updatedAt,
    connection, officialTemplate, deliveryContent,
    recipients: rows.map(row => [String(row.invitation._id), row.invitation.responseStatus,
      row.invitation.responseVersion, row.invitation.expiresAt, row.invitation.revokedAt,
      row.guest?.name, row.guest?.phone, row.guest?.whatsappConsent, row.guest?.whatsappOptedOutAt, row.guest?.updatedAt]),
    adminPhone,
  })
  return { preview: { recipientCount, sample, deliveryContent, previewHash } }
}

export async function activateRule(organizationId: string, eventId: string, rawType: string, input: unknown) {
  const parsed = activationInput.safeParse(input)
  const parsedType = typeSchema.safeParse(rawType)
  if (!parsed.success || !parsedType.success) return { error: 'INVALID' as const }
  const previewResult = await previewRule(organizationId, eventId, parsedType.data)
  if ('error' in previewResult) return previewResult
  const [event, connection] = await Promise.all([
    EventModel.findOne({ _id: eventId, organizationId }), activeConnectionIdentity(organizationId),
  ])
  if (!event) return { error: 'NOT_FOUND' as const }
  if (!connection) return { error: 'CONFLICT' as const }
  const identity = connection
  const officialTemplate = identity.approvedChannel === 'cloud'
    ? await approvedEvolutionTemplate(organizationId, String(identity.approvedConnectionId), parsedType.data) : null
  if (identity.approvedChannel === 'cloud' && !officialTemplate) return { error: 'NO_TEMPLATE' as const }
  const rule = await AutomationRuleModel.findOne({ organizationId, eventId, type: parsedType.data })
  if (!rule || rule.revision !== parsed.data.expectedRevision || !rule.enabled ||
    previewResult.preview.previewHash !== parsed.data.previewHash ||
    (rule.type === 'admin_summary' && !adminRecipient())) return { error: 'CONFLICT' as const }
  const now = new Date()
  const updated = await AutomationRuleModel.findOneAndUpdate({ _id: rule._id, revision: rule.revision, enabled: true },
    { $set: { activatedRevision: rule.revision, activatedAt: now,
      activatedConnectionId: identity.approvedConnectionId,
      activatedConnectionServerUrl: identity.approvedConnectionServerUrl,
      activatedConnectionTokenHash: identity.approvedConnectionTokenHash,
      activatedProvider: identity.approvedProvider, activatedChannel: identity.approvedChannel,
      activatedConnectionRevision: identity.approvedConnectionRevision,
      ...(officialTemplate ? { activatedTemplateName: officialTemplate.name,
        activatedTemplateLanguage: officialTemplate.language,
        activatedTemplateRevision: officialTemplate.revision } : {}),
      activatedMode: identity.approvedMode,
      activationEventVersion: event.changeVersion || 0, activationEventUpdatedAt: event.updatedAt } }, { returnDocument: 'after' })
  if (!updated) return { error: 'CONFLICT' as const }
  const refreshed = await previewRule(organizationId, eventId, parsedType.data)
  if ('error' in refreshed || refreshed.preview.previewHash !== parsed.data.previewHash) {
    await AutomationRuleModel.updateOne({ _id: updated._id, revision: updated.revision, activatedRevision: updated.revision },
      { $set: { activatedRevision: null } })
    return { error: 'CONFLICT' as const }
  }
  const planned = await planRule(updated, event)
  return { rule: presentRule(updated), planned }
}

async function renderText(rule: any, event: any, invitation: any, guest: any): Promise<string> {
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: event.timeZone }).format(event.startsAt)
  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: event.timeZone }).format(event.startsAt)
  let link = ''
  if (invitation && rule.text.includes('{{convite.link}}')) {
    const result = await getInvitationLink(String(rule.organizationId), String(rule.eventId), String(invitation._id))
    if (!result || 'error' in result) throw new Error('Link do convite indisponível')
    link = result.link
  }
  const summary = rule.type === 'admin_summary' ? await InvitationModel.aggregate([
    { $match: { organizationId: rule.organizationId, eventId: rule.eventId } },
    { $group: { _id: '$responseStatus', count: { $sum: 1 } } },
  ]) as { _id: string; count: number }[] : []
  const counts = Object.fromEntries(summary.map(row => [row._id, row.count]))
  const values = { 'convidado.nome': guest?.name || '', 'evento.nome': event.name,
    'evento.data': date, 'evento.horario': time, 'evento.local': event.location,
    'convite.link': link, 'convite.limite_acompanhantes': invitation?.companionLimit || 0 }
  const template = resolveTemplateText(rule.text, values)
  return template.replace(/\{\{resumo\.(pendentes|confirmados|recusados)\}\}/g, (_all: string, key: string) =>
    String(counts[{ pendentes: 'pending', confirmados: 'accepted', recusados: 'declined' }[key]!] || 0))
}

async function planRule(rule: any, event: any): Promise<number> {
  if (!rule.enabled || rule.activatedRevision !== rule.revision || !eventAllows(rule, event)) return 0
  const connection = await activeConnectionIdentity(String(rule.organizationId))
  if (!connection) return 0
  const identity = connection
  if (!activationMatches(rule, identity)) return 0
  const officialTemplate = identity.approvedChannel === 'cloud'
    ? await approvedEvolutionTemplate(String(rule.organizationId), String(identity.approvedConnectionId), rule.type) : null
  if (identity.approvedChannel === 'cloud' && (!officialTemplate ||
    officialTemplate.name !== rule.activatedTemplateName ||
    officialTemplate.revision !== rule.activatedTemplateRevision)) return 0
  const now = new Date()
  const rows = await candidates(rule, event)
  const entries = rule.type === 'admin_summary' ? [{ invitation: null, guest: null,
    due: scheduledAt(rule, event, null), reason: adminRecipient() ? undefined : 'admin_not_configured' }] : rows
  let created = 0
  await DeliveryModel.init()
  for (const row of entries) {
    if (row.reason || !row.due) continue
    const invitation = row.invitation
    const guest = row.guest
    const recipientPhone = rule.type === 'admin_summary' ? adminRecipient() : guest?.phone
    if (!recipientPhone) continue
    if (rule.type === 'initial') {
      if (row.due > now || row.due.getTime() + rule.graceMinutes * 60_000 < now.getTime()) continue
      const currentConnection = await activeConnectionIdentity(String(rule.organizationId))
      if (!currentConnection || !activationMatches(rule, currentConnection)) return created
      const alreadySent = await DeliveryModel.exists({ organizationId: rule.organizationId,
        eventId: rule.eventId, invitationId: invitation._id, type: 'initial',
        $or: [{ status: 'completed' }, { 'media.status': 'accepted' }, { 'text.status': 'accepted' }] })
      if (alreadySent) continue
      const initial = await previewInitialDelivery(String(rule.organizationId), String(rule.eventId), String(invitation._id))
      if ('error' in initial) continue
      const reviewedConnection = await activeConnectionIdentity(String(rule.organizationId))
      if (!reviewedConnection || !activationMatches(rule, reviewedConnection)) return created
      const approved = await approveInitialDelivery(String(rule.organizationId), String(rule.eventId),
        { invitationId: String(invitation._id), approve: true, previewHash: initial.preview.previewHash })
      if ('delivery' in approved && approved.created) created++
      continue
    }
    const count = await DeliveryModel.countDocuments({ automationRuleId: rule._id,
      ...(invitation ? { invitationId: invitation._id } : {}), status: 'completed' })
    if (count >= rule.maxExecutions) continue
    const rendered = await renderText(rule, event, invitation, guest)
    const graceUntil = new Date(row.due.getTime() + rule.graceMinutes * 60_000)
    const late = graceUntil < now
    const filter = { automationRuleId: rule._id, automationRevision: rule.revision,
      ...(invitation ? { invitationId: invitation._id } : {}), automationOccurrence: occurrence(rule, event, invitation) }
    const payload = { ...filter, organizationId: rule.organizationId, eventId: rule.eventId,
      ...(invitation ? { guestId: invitation.guestId } : {}), type: 'automation',
      templateVersion: invitation?.templateVersion || event.publishedTemplateVersion || 1,
      contentHash: hash([rendered, recipientPhone, filter, identity]), ...identity, recipientPhone,
      ...(officialTemplate ? { approvedTemplateName: officialTemplate.name,
        approvedTemplateLanguage: officialTemplate.language,
        approvedTemplateRevision: officialTemplate.revision } : {}),
      status: late ? 'suppressed' : 'queued', media: { status: 'skipped' },
      text: { status: late ? 'suppressed' : 'pending' }, automationText: rendered,
      scheduledAt: row.due, graceUntil, approvedAt: rule.activatedAt || now,
      ...(late ? { suppressionReason: 'late' } : {}),
    }
    try { await DeliveryModel.create(payload); created++ }
    catch (error) { if (!isDuplicate(error)) throw error }
  }
  return created
}

export async function planDueRules(limit = 100): Promise<number> {
  await connectDatabase()
  const rules = await AutomationRuleModel.find({ enabled: true, $expr: { $eq: ['$revision', '$activatedRevision'] } })
    .sort({ updatedAt: 1 }).limit(Math.max(1, Math.min(limit, 500)))
  let planned = 0
  for (const rule of rules) {
    const event = await EventModel.findOne({ _id: rule.eventId, organizationId: rule.organizationId })
    if (event) planned += await planRule(rule, event)
  }
  return planned
}

export async function evaluateAutomationDelivery(deliveryId: string): Promise<
  { eligible: true; text: string; recipientPhone: string } | { eligible: false; reason: string }
> {
  if (!ID.test(deliveryId)) return { eligible: false, reason: 'invalid_id' }
  await connectDatabase()
  const delivery = await DeliveryModel.findById(deliveryId)
  if (!delivery || delivery.type !== 'automation') return { eligible: false, reason: 'not_found' }
  const [rule, event, invitation, guest, connection] = await Promise.all([
    AutomationRuleModel.findById(delivery.automationRuleId),
    EventModel.findOne({ _id: delivery.eventId, organizationId: delivery.organizationId }),
    delivery.invitationId ? InvitationModel.findOne({ _id: delivery.invitationId, organizationId: delivery.organizationId }) : null,
    delivery.guestId ? GuestModel.findOne({ _id: delivery.guestId, organizationId: delivery.organizationId }) : null,
    activeConnectionIdentity(String(delivery.organizationId)),
  ])
  if (!rule || rule.revision !== delivery.automationRevision || rule.activatedRevision !== rule.revision || !rule.enabled) {
    return { eligible: false, reason: 'rule_revision_changed' }
  }
  if (!connection || !activationMatches(rule, connection) ||
    String(delivery.approvedConnectionId) !== String(rule.activatedConnectionId) ||
    delivery.approvedConnectionServerUrl !== rule.activatedConnectionServerUrl ||
    delivery.approvedConnectionTokenHash !== rule.activatedConnectionTokenHash ||
    delivery.approvedMode !== rule.activatedMode) return { eligible: false, reason: 'connection_changed' }
  if (connection.approvedChannel === 'cloud') {
    const currentTemplate = await approvedEvolutionTemplate(String(delivery.organizationId),
      String(connection.approvedConnectionId), rule.type)
    if (!currentTemplate || currentTemplate.name !== delivery.approvedTemplateName ||
      currentTemplate.language !== delivery.approvedTemplateLanguage ||
      currentTemplate.revision !== delivery.approvedTemplateRevision) return { eligible: false, reason: 'template_changed' }
  }
  if (!event || !eventAllows(rule, event)) return { eligible: false, reason: 'event_changed' }
  const recalculatedDue = scheduledAt(rule, event, invitation)
  if (!recalculatedDue || recalculatedDue.getTime() !== delivery.scheduledAt.getTime()) {
    return { eligible: false, reason: 'schedule_changed' }
  }
  if (rule.type === 'admin_summary') {
    const phone = adminRecipient()
    if (!phone || phone !== delivery.recipientPhone) return { eligible: false, reason: 'admin_not_configured' }
  } else {
    if (!invitation || !guest || !invitationUsable(rule, event, invitation, new Date())) return { eligible: false, reason: 'invitation_inactive' }
    if (!audienceMatches(rule.audience, invitation.responseStatus)) return { eligible: false, reason: 'rsvp_changed' }
    if (!hasGuestWhatsAppConsent(guest)) return { eligible: false, reason: 'no_consent' }
    if (guest.whatsappOptedOutAt) return { eligible: false, reason: 'opt_out' }
    if (guest.phone !== delivery.recipientPhone) return { eligible: false, reason: 'phone_changed' }
    if (rule.type === 'pending_reminder' && event.rsvpDeadline <= new Date()) return { eligible: false, reason: 'deadline_passed' }
    if (occurrence(rule, event, invitation) !== delivery.automationOccurrence) return { eligible: false, reason: 'occurrence_changed' }
  }
  const count = await DeliveryModel.countDocuments({ automationRuleId: rule._id,
    ...(invitation ? { invitationId: invitation._id } : {}), status: 'completed', _id: { $ne: delivery._id } })
  if (count >= rule.maxExecutions) return { eligible: false, reason: 'max_executions' }
  if (delivery.scheduledAt > new Date()) return { eligible: false, reason: 'not_due' }
  if (delivery.graceUntil < new Date()) return { eligible: false, reason: 'late' }
  let currentText: string
  try { currentText = await renderText(rule, event, invitation, guest) }
  catch { return { eligible: false, reason: 'content_unavailable' } }
  if (currentText !== delivery.automationText) return { eligible: false, reason: 'content_changed' }
  return { eligible: true, text: currentText, recipientPhone: delivery.recipientPhone }
}

export async function listJobs(organizationId: string, eventId: string, limit = 50) {
  if (!validScope(organizationId, eventId) || !Number.isInteger(limit) || limit < 1 || limit > 50) return null
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return null
  const docs = await DeliveryModel.find({ organizationId, eventId, type: 'automation' }).sort({ createdAt: -1, _id: -1 }).limit(limit)
  const [guests, rules] = await Promise.all([
    GuestModel.find({ organizationId, _id: { $in: docs.map(doc => doc.guestId).filter(Boolean) } }).select('name'),
    AutomationRuleModel.find({ organizationId, eventId,
      _id: { $in: docs.map(doc => doc.automationRuleId).filter(Boolean) } }).select('type'),
  ])
  const names = new Map(guests.map(doc => [String(doc._id), doc.name as string]))
  const ruleTypes = new Map(rules.map(doc => [String(doc._id), doc.type as AutomationType]))
  return { items: docs.map(doc => ({ id: String(doc._id), type: 'automation' as const,
    ruleType: ruleTypes.get(String(doc.automationRuleId)) || 'unknown',
    ...(doc.invitationId ? { invitationId: String(doc.invitationId) } : {}),
    ...(doc.guestId ? { guestName: names.get(String(doc.guestId)) || '' } : {}),
    recipientPhone: doc.recipientPhone as string, status: doc.status as string,
    scheduledAt: doc.scheduledAt?.toISOString() || '',
    ...(doc.suppressionReason ? { suppressionReason: doc.suppressionReason as string } : {}),
    updatedAt: doc.updatedAt.toISOString() as string })) }
}

export async function suppressGuest(organizationId: string, eventId: string, guestId: string, reason: string) {
  const parsed = suppressionInput.safeParse({ reason })
  if (!validScope(organizationId, eventId) || !ID.test(guestId) || !parsed.success) return null
  await connectDatabase()
  if (!await InvitationModel.exists({ organizationId, eventId, guestId })) return null
  const updated = await GuestModel.updateOne({ _id: guestId, organizationId },
    { $set: { whatsappOptedOutAt: new Date(), whatsappOptOutReason: parsed.data.reason } })
  return updated.matchedCount ? { guestId, suppressed: true as const } : null
}
