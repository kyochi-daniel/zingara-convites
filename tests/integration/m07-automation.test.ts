import { createHash, randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { connectDatabase, DeliveryModel, EventModel, GuestModel, InvitationModel, OrganizationModel, TemplateVersionModel } from '../../packages/database/src/index'
import { cancelEvent, createEvolutionConnection, processDelivery, provisionEvolutionConnection, revisePublishedEvent, saveEvolutionTemplate, selectActiveConnection } from '../../packages/core/src/index'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { activateRule, evaluateAutomationDelivery, listJobs, planDueRules, previewRule, saveRule, suppressGuest } from '../../packages/automations/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_m07_${randomUUID().replaceAll('-', '').slice(0, 12)}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m07-evolution`).digest('base64')
process.env.EVOLUTION_BASE_URL = 'https://evolution.example.test'
process.env.EVOLUTION_MODE = 'fake'
let organizationId: string
const whatsappAuthorization = { source: 'Formulário presencial assinado', confirmedBy: 'a'.repeat(24), confirmedAt: new Date() }
let eventId: string
let guestId: string
let invitationId: string

beforeAll(async () => {
  await connectDatabase()
  organizationId = String((await OrganizationModel.create({ name: 'M07 Automations' }))._id)
  const event = await EventModel.create({ organizationId, name: 'Festa', location: 'Campo Grande', address: 'Centro',
    status: 'published', startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), timeZone: 'America/Campo_Grande', companionLimit: 1,
    companionNamesRequired: false, publishedTemplateVersion: 1 })
  eventId = event.id
  const guest = await GuestModel.create({ organizationId, name: 'Ana', phone: '+5567999999999', whatsappConsent: true, whatsappAuthorization })
  guestId = guest.id
  const invitation = await InvitationModel.create({ organizationId, eventId, guestId,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 86_400_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), companionLimit: 1, companionNamesRequired: false, responseStatus: 'pending' })
  invitationId = invitation.id
  const connection = await createEvolutionConnection(organizationId, { channel: 'baileys' })
  if (!('connection' in connection)) throw new Error('Conexão Evolution indisponível')
  expect(await provisionEvolutionConnection(organizationId, connection.connection.id)).toHaveProperty('connection')
  expect(await selectActiveConnection(organizationId, connection.connection.id)).toHaveProperty('connection')
})

afterAll(async () => {
  const mongo = await connectDatabase()
  await mongo.connection.dropDatabase()
  await mongo.disconnect()
})

test('plans pending reminders once and suppresses them after RSVP changes', async () => {
  const input = { enabled: true, audience: 'pending' as const,
    schedule: { anchor: 'rsvp_deadline' as const, offsetMinutes: -25 }, text: 'Olá, {{convidado.nome}}. Confirme sua presença.',
    maxExecutions: 1, graceMinutes: 60, expectedRevision: 0 }
  const saved = await saveRule(organizationId, eventId, 'pending_reminder', input)
  expect(saved.rule?.revision).toBe(1)
  const preview = await previewRule(organizationId, eventId, 'pending_reminder')
  expect(preview.preview?.recipientCount).toBe(1)
  expect(preview.preview?.sample[0]?.invitationId).toBe(invitationId)
  const activation = await activateRule(organizationId, eventId, 'pending_reminder', {
    expectedRevision: 1, previewHash: preview.preview!.previewHash,
  })
  expect(activation.rule?.activatedRevision).toBe(1)
  await planDueRules()
  await planDueRules()
  const jobs = await DeliveryModel.find({ automationRuleId: activation.rule!.id })
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.status).toBe('queued')
  await InvitationModel.updateOne({ _id: invitationId }, { $set: { responseStatus: 'accepted', responseVersion: 1 } })
  expect(await evaluateAutomationDelivery(String(jobs[0]?._id))).toMatchObject({ eligible: false, reason: 'rsvp_changed' })
})

test('new revision and manual suppression invalidate planned work', async () => {
  const changed = await saveRule(organizationId, eventId, 'pending_reminder', {
    enabled: true, audience: 'pending', schedule: { anchor: 'rsvp_deadline', offsetMinutes: -20 },
    text: 'Novo texto', maxExecutions: 1, graceMinutes: 60, expectedRevision: 1,
  })
  expect(changed.rule?.revision).toBe(2)
  const job = await DeliveryModel.findOne({ invitationId, type: 'automation' })
  expect(await evaluateAutomationDelivery(String(job?._id))).toMatchObject({ eligible: false, reason: 'rule_revision_changed' })
  expect(await suppressGuest(organizationId, eventId, guestId, 'Solicitação do contato')).toEqual({ guestId, suppressed: true })
  expect((await GuestModel.findById(guestId))?.whatsappOptedOutAt).toBeTruthy()
})

test('lembrete usa prazo e término atuais do evento quando convite está antigo', async () => {
  const now = Date.now()
  const guest = await GuestModel.create({ organizationId, name: 'Prazo atual', phone: '+5567333333333',
    whatsappConsent: true, whatsappAuthorization })
  const makeEvent = async (name: string, endsAt: Date, rsvpDeadline: Date) => EventModel.create({
    organizationId, name, location: 'Campo Grande', address: 'Centro', status: 'published',
    startsAt: new Date(now + 86_400_000), endsAt, rsvpDeadline, timeZone: 'America/Campo_Grande',
    companionLimit: 0, companionNamesRequired: false, publishedTemplateVersion: 1,
  })
  const makeInvitation = async (targetEvent: any) => InvitationModel.create({ organizationId,
    eventId: targetEvent.id, guestId: guest.id, templateVersion: 1, secretHash: randomUUID(),
    secretCiphertext: 'test', expiresAt: new Date(now + 90_000_000),
    rsvpDeadline: new Date(now + 60 * 60_000), companionLimit: 0,
    companionNamesRequired: false, responseStatus: 'pending' })
  const makeRule = async (targetEvent: any) => saveRule(organizationId, targetEvent.id, 'pending_reminder', {
    enabled: true, audience: 'pending', schedule: { anchor: 'rsvp_deadline', offsetMinutes: -10 },
    text: 'Lembrete', maxExecutions: 1, graceMinutes: 60, expectedRevision: 0,
  })

  const deadlinePassed = await makeEvent('Prazo encerrado', new Date(now + 90_000_000), new Date(now - 60_000))
  await makeInvitation(deadlinePassed)
  await makeRule(deadlinePassed)
  expect(await previewRule(organizationId, deadlinePassed.id, 'pending_reminder')).toMatchObject({
    preview: { recipientCount: 0, sample: [{ eligible: false, reason: 'deadline_passed' }] },
  })

  const eventEnded = await makeEvent('Evento encerrado', new Date(now - 60_000), new Date(now + 60 * 60_000))
  await makeInvitation(eventEnded)
  await makeRule(eventEnded)
  expect(await previewRule(organizationId, eventEnded.id, 'pending_reminder')).toMatchObject({
    preview: { recipientCount: 0, sample: [{ eligible: false, reason: 'invitation_inactive' }] },
  })
})

test('uses the shared delivery processor for an approved receipt in fake mode', async () => {
  const guest = await GuestModel.create({ organizationId, name: 'Bia', phone: '+5567888888888', whatsappConsent: true, whatsappAuthorization })
  const invitation = await InvitationModel.create({ organizationId, eventId, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 86_400_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), companionLimit: 1, companionNamesRequired: false,
    responseStatus: 'accepted', responseVersion: 1, respondedAt: new Date(Date.now() - 5000) })
  const saved = await saveRule(organizationId, eventId, 'receipt', {
    enabled: true, audience: 'accepted', schedule: { anchor: 'rsvp_update', offsetMinutes: 0 },
    text: 'Recebemos sua confirmação, {{convidado.nome}}.', maxExecutions: 1, graceMinutes: 60, expectedRevision: 0,
  })
  const preview = await previewRule(organizationId, eventId, 'receipt')
  const activated = await activateRule(organizationId, eventId, 'receipt', {
    expectedRevision: saved.rule!.revision, previewHash: preview.preview!.previewHash,
  })
  expect(activated.planned).toBe(1)
  const job = await DeliveryModel.findOne({ type: 'automation', invitationId: invitation.id })
  expect(job).toBeTruthy()
  expect((await listJobs(organizationId, eventId))?.items.find(item => item.id === String(job!._id)))
    .toMatchObject({ ruleType: 'receipt', type: 'automation' })
  expect(await evaluateAutomationDelivery(String(job!._id))).toMatchObject({ eligible: true })
  await processDelivery(String(job!._id), {
    renderMedia: async () => { throw new Error('Automação de texto não renderiza mídia') },
    evaluateAutomation: evaluateAutomationDelivery,
  })
  const sent = await DeliveryModel.findById(job!._id)
  expect(sent?.status, JSON.stringify({ text: sent?.text, suppressionReason: sent?.suppressionReason,
    nextAttemptAt: sent?.nextAttemptAt, attempts: sent?.attempts })).toBe('completed')
  expect(sent?.text.status).toBe('accepted')
  expect(sent?.text.messageId).toMatch(/^fake-evolution-/)
  await processDelivery(String(job!._id), {
    renderMedia: async () => { throw new Error('Não deve renderizar') }, evaluateAutomation: evaluateAutomationDelivery,
  })
  expect((await DeliveryModel.findById(job!._id))?.attempts).toHaveLength(1)
})

test('plans cancellation notices after the event revokes invitations', async () => {
  const guest = await GuestModel.create({ organizationId, name: 'Cris', phone: '+5567777777777', whatsappConsent: true, whatsappAuthorization })
  const invitation = await InvitationModel.create({ organizationId, eventId, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 86_400_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), companionLimit: 1, companionNamesRequired: false,
    responseStatus: 'pending' })
  const saved = await saveRule(organizationId, eventId, 'event_cancellation', {
    enabled: true, audience: 'pending', schedule: { anchor: 'event_cancelled', offsetMinutes: 0 },
    text: 'O evento {{evento.nome}} foi cancelado.', maxExecutions: 1, graceMinutes: 60, expectedRevision: 0,
  })
  const preview = await previewRule(organizationId, eventId, 'event_cancellation')
  expect(await activateRule(organizationId, eventId, 'event_cancellation', {
    expectedRevision: saved.rule!.revision, previewHash: preview.preview!.previewHash,
  })).toHaveProperty('rule')
  const revision = (await EventModel.findById(eventId))!.revision
  const cancelled = await cancelEvent(organizationId, eventId, { expectedRevision: revision })
  expect(cancelled).toHaveProperty('event.status', 'cancelled')
  expect((await InvitationModel.findById(invitation.id))?.revokedAt).toBeTruthy()
  await planDueRules()
  const job = await DeliveryModel.findOne({ type: 'automation', invitationId: invitation.id,
    automationRuleId: saved.rule!.id })
  expect(job?.status).toBe('queued')
  expect(await evaluateAutomationDelivery(String(job!._id))).toMatchObject({ eligible: true })
})

test('creates one notice for an explicit published event revision', async () => {
  const event = await EventModel.create({ organizationId, name: 'Baile', location: 'Salão A', address: 'Rua A',
    status: 'published', startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), timeZone: 'America/Campo_Grande', companionLimit: 1,
    companionNamesRequired: false, publishedTemplateVersion: 1 })
  await TemplateVersionModel.create({ organizationId, eventId: event.id, version: 1,
    sourceDraftRevision: 0, sourceEventUpdatedAt: event.updatedAt,
    template: defaultTemplate, event: { name: event.name, location: event.location, address: event.address,
      startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
      rsvpDeadline: event.rsvpDeadline.toISOString(), timeZone: event.timeZone,
      companionLimit: event.companionLimit, companionNamesRequired: event.companionNamesRequired } })
  const guest = await GuestModel.create({ organizationId, name: 'Dani', phone: '+5567666666666', whatsappConsent: true, whatsappAuthorization })
  const invitation = await InvitationModel.create({ organizationId, eventId: event.id, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 86_400_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), companionLimit: 1, companionNamesRequired: false,
    responseStatus: 'pending' })
  const saved = await saveRule(organizationId, event.id, 'event_change', {
    enabled: true, audience: 'all', schedule: { anchor: 'event_update', offsetMinutes: 0 },
    text: 'O local mudou para {{evento.local}}.', maxExecutions: 2, graceMinutes: 60, expectedRevision: 0,
  })
  const preview = await previewRule(organizationId, event.id, 'event_change')
  const activation = await activateRule(organizationId, event.id, 'event_change', {
    expectedRevision: saved.rule!.revision, previewHash: preview.preview!.previewHash,
  })
  expect(activation.planned).toBe(0)
  const revised = await revisePublishedEvent(organizationId, event.id, {
    expectedRevision: event.revision, changes: { location: 'Salão B' },
  })
  expect(revised).toHaveProperty('event.changeVersion', 1)
  await planDueRules()
  await planDueRules()
  const jobs = await DeliveryModel.find({ type: 'automation', invitationId: invitation.id,
    automationRuleId: saved.rule!.id })
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.automationOccurrence).toBe('change-1')
  expect(jobs[0]?.automationText).toContain('Salão B')
})

test('connection rotation blocks an activated rule until a new reviewed activation', async () => {
  const event = await EventModel.create({ organizationId, name: 'Feira', location: 'Pavilhão', address: 'Rua B',
    status: 'published', startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
    rsvpDeadline: new Date(Date.now() + 30 * 60_000), timeZone: 'America/Campo_Grande', companionLimit: 1,
    companionNamesRequired: false, publishedTemplateVersion: 1 })
  const createRecipient = async (name: string, phone: string) => {
    const guest = await GuestModel.create({ organizationId, name, phone, whatsappConsent: true, whatsappAuthorization })
    return InvitationModel.create({ organizationId, eventId: event.id, guestId: guest.id,
      templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 86_400_000),
      rsvpDeadline: new Date(Date.now() + 30 * 60_000), companionLimit: 1, companionNamesRequired: false,
      responseStatus: 'accepted', responseVersion: 1, respondedAt: new Date(Date.now() - 5000) })
  }
  const first = await createRecipient('Eva', '+5567555555555')
  const saved = await saveRule(organizationId, event.id, 'receipt', {
    enabled: true, audience: 'accepted', schedule: { anchor: 'rsvp_update', offsetMinutes: 0 },
    text: 'Confirmação recebida, {{convidado.nome}}.', maxExecutions: 1, graceMinutes: 60, expectedRevision: 0,
  })
  const preview = await previewRule(organizationId, event.id, 'receipt')
  expect(await activateRule(organizationId, event.id, 'receipt', {
    expectedRevision: saved.rule!.revision, previewHash: preview.preview!.previewHash,
  })).toHaveProperty('planned', 1)
  const oldJob = await DeliveryModel.findOne({ type: 'automation', invitationId: first.id })
  expect(oldJob).toBeTruthy()
  const cloud = await createEvolutionConnection(organizationId, { channel: 'cloud',
    metaToken: 'meta-token-for-automation-test', phoneNumberId: '123456789012', businessId: '234567890123' })
  if (!('connection' in cloud)) throw new Error('Conexão oficial indisponível')
  expect(await provisionEvolutionConnection(organizationId, cloud.connection.id)).toHaveProperty('connection')
  expect(await saveEvolutionTemplate(organizationId, cloud.connection.id,
    { type: 'receipt', name: 'recibo_01', language: 'pt_BR' })).toHaveProperty('template')
  expect(await selectActiveConnection(organizationId, cloud.connection.id)).toHaveProperty('connection')
  expect(await evaluateAutomationDelivery(String(oldJob!._id)))
    .toMatchObject({ eligible: false, reason: 'connection_changed' })
  const second = await createRecipient('Fê', '+5567444444444')
  await planDueRules()
  expect(await DeliveryModel.exists({ type: 'automation', invitationId: second.id })).toBeNull()
  const reviewed = await previewRule(organizationId, event.id, 'receipt')
  expect(reviewed.preview!.previewHash).not.toBe(preview.preview!.previewHash)
  expect(reviewed.preview!.deliveryContent).toEqual({ kind: 'official_template', name: 'recibo_01',
    language: 'pt_BR', variables: [], textUsed: false })
  expect(await activateRule(organizationId, event.id, 'receipt', {
    expectedRevision: saved.rule!.revision, previewHash: reviewed.preview!.previewHash,
  })).toHaveProperty('planned', 1)
  expect(await DeliveryModel.exists({ type: 'automation', invitationId: second.id })).toBeTruthy()
})
