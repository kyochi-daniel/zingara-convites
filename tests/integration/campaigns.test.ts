import { randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { connectDatabase, DeliveryCampaignModel, DeliveryModel, EventModel, EvolutionConnectionModel, GuestModel, InvitationModel, LoginAttemptModel, NumberVerificationModel, TemplateVersionModel } from '../../packages/database/src/index'
import * as coreBase from '../../packages/core/src/index'
import * as campaignCore from '../../packages/core/src/campaigns'
import { createEvolutionClient, EvolutionHttpError } from '../../packages/integrations/src/index'

const core = { ...coreBase, ...campaignCore }

vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 })
loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_campaign_${randomUUID().replaceAll('-', '').slice(0, 10)}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_BASE_URL = 'https://evolution.campaign.test'
process.env.EVOLUTION_MODE = 'fake'
process.env.EVOLUTION_CONTROL_REAL_ENABLED = '0'
process.env.EVOLUTION_REAL_ENABLED = '0'
process.env.EVOLUTION_REAL_SEND_ENABLED = '0'
delete process.env.EVOLUTION_API_KEY
let org: string
let eventId: string
let connectionId: string

beforeAll(async () => {
  org = (await core.createOrganization({ name: 'Campanhas' })).id
  const event = await EventModel.create({ organizationId: org, name: 'Festa', location: 'Jardim', address: 'Centro',
    status: 'published', startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
    rsvpDeadline: new Date(Date.now() + 3_600_000), timeZone: 'America/Campo_Grande', companionLimit: 1,
    companionNamesRequired: false, publishedTemplateVersion: 1 })
  eventId = event.id
  await TemplateVersionModel.create({ organizationId: org, eventId, version: 1, sourceDraftRevision: 1,
    sourceEventUpdatedAt: event.updatedAt, template: defaultTemplate, event: { ...event.toObject(), startsAt: event.startsAt.toISOString() } })
  const result = await core.createEvolutionConnection(org, { channel: 'baileys' })
  if (!('connection' in result)) throw new Error('Conexão fake indisponível')
  connectionId = result.connection.id
  await core.provisionEvolutionConnection(org, result.connection.id)
  await core.selectActiveConnection(org, result.connection.id)
})

beforeEach(async () => {
  await LoginAttemptModel.deleteMany({ _id: /^evolution-number/ })
  await NumberVerificationModel.deleteMany({})
  await EvolutionConnectionModel.updateMany({}, { $unset: { nextCampaignSendAt: '' } })
})

afterAll(async () => {
  const mongo = await connectDatabase()
  await mongo.connection.dropDatabase()
  await mongo.disconnect()
})

async function invitation(consent = true) {
  const guest = await GuestModel.create({ organizationId: org, name: `Pessoa ${randomUUID()}`, phone: '+5567999999999',
    whatsappConsent: consent, ...(consent ? { whatsappAuthorization: {
      source: 'Formulário presencial assinado', confirmedBy: 'a'.repeat(24), confirmedAt: new Date(),
    } } : {}) })
  const result = await core.createInvitation(org, eventId, { guestId: guest.id })
  if (!('invitation' in result)) throw new Error('Convite indisponível')
  return { id: result.invitation.id, guestId: guest.id }
}

async function plan(count = 1, intervalMs = 60_000) {
  const invitations = []
  for (let index = 0; index < count; index++) invitations.push(await invitation())
  const result = await core.previewDeliveryCampaign(org, eventId, { invitationIds: invitations.map(item => item.id), intervalMs })
  expect(result).toHaveProperty('campaign')
  if (!('campaign' in result)) throw new Error('Plano indisponível')
  return { ...result, invitations }
}

async function scheduledPlan(count = 1) {
  const invitations = []
  for (let index = 0; index < count; index++) invitations.push(await invitation())
  const scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString()
  const result = await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: invitations.map(item => item.id), intervalMs: 60_000, scheduledAt,
  })
  expect(result).toHaveProperty('campaign')
  if (!('campaign' in result)) throw new Error('Plano agendado indisponível')
  return { ...result, invitations, scheduledAt }
}

async function approved(count = 1) {
  const planned = await plan(count)
  const result = await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })
  expect(result).toMatchObject({ campaign: { status: 'running' } })
  return { ...planned, deliveries: await DeliveryModel.find({ campaignId: planned.campaign.id }).sort({ _id: 1 }) }
}

function fakeDependencies(overrides: Partial<ReturnType<typeof createEvolutionClient>> = {}) {
  const sent: string[] = []
  return { sent, renderMedia: async () => ({ url: `${process.env.INVITE_ORIGIN}/media/test.webp`, expiresAt: new Date(Date.now() + 600_000) }),
    createEvolutionClient: (config: Parameters<typeof createEvolutionClient>[0]) => ({ ...createEvolutionClient({ ...config, mode: 'fake' }),
      sendMedia: async () => { sent.push('media'); return { messageId: randomUUID(), status: 'sent' as const } },
      sendText: async () => { sent.push('text'); return { messageId: randomUUID(), status: 'sent' as const } }, ...overrides }) }
}

test('campanha bloqueia consentimento legado sem origem auditável', async () => {
  const item = await invitation()
  await GuestModel.updateOne({ _id: item.guestId }, { $unset: { whatsappAuthorization: 1 } })
  expect(await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs: 5000 }))
    .toEqual({ error: 'INELIGIBLE' })
})

test('plano revisável não enfileira, exige IDs do evento, consentimento e cadência limitada', async () => {
  const item = await invitation()
  const result = await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs: 2000 })
  expect(result).toMatchObject({ campaign: { status: 'draft' }, preview: { intervalMs: 2000,
    items: [{ invitationId: item.id, recipient: { whatsappConsent: true }, text: expect.any(String) }], previewHash: expect.stringMatching(/^[a-f0-9]{64}$/) } })
  expect(await DeliveryModel.countDocuments({ invitationId: item.id })).toBe(0)
  for (const intervalMs of [0, 1999, 3600001]) {
    expect(await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs })).toEqual({ error: 'INVALID' })
  }
  expect(await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id, item.id] })).toEqual({ error: 'INVALID' })
  expect(await core.previewDeliveryCampaign(org, '0'.repeat(24), { invitationIds: [item.id] })).toEqual({ error: 'NOT_FOUND' })
  const noConsent = await invitation(false)
  expect(await core.previewDeliveryCampaign(org, eventId, { invitationIds: [noConsent.id] })).toEqual({ error: 'INELIGIBLE' })
  if (!('campaign' in result)) throw new Error('Plano ausente')
  expect(await core.getDeliveryCampaignPreview(org, eventId, result.campaign.id)).toMatchObject({ preview: result.preview })
  const repeat = await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs: 2000 })
  expect(repeat).toMatchObject({ campaign: { id: result.campaign.id } })
  await GuestModel.updateOne({ _id: item.guestId }, { $set: { name: 'Nome alterado' } })
  expect(await core.getDeliveryCampaignPreview(org, eventId, result.campaign.id)).toEqual({ error: 'CONFLICT' })
  const stored = await DeliveryCampaignModel.findById(result.campaign.id)
  expect(JSON.stringify(stored)).not.toContain('/i/')
})

test('agendamento entra no hash, respeita o prazo de RSVP e não despacha antes da hora', async () => {
  const item = await invitation()
  const scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString()
  const immediate = await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs: 5000 })
  const planned = await core.previewDeliveryCampaign(org, eventId, { invitationIds: [item.id], intervalMs: 5000, scheduledAt })
  expect(planned).toMatchObject({ campaign: { status: 'draft', scheduledAt, cancelledAt: null },
    preview: { scheduledAt, previewHash: expect.stringMatching(/^[a-f0-9]{64}$/) } })
  if (!('preview' in immediate) || !('preview' in planned)) throw new Error('Prévia indisponível')
  expect(planned.preview.previewHash).not.toBe(immediate.preview.previewHash)
  expect(await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: [item.id], scheduledAt: new Date(Date.now() - 1000).toISOString(),
  })).toEqual({ error: 'INVALID' })
  expect(await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: [item.id], scheduledAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  })).toEqual({ error: 'INVALID' })
  const expiringItem = await invitation()
  await InvitationModel.updateOne({ _id: expiringItem.id }, { $set: { expiresAt: new Date(Date.now() + 20 * 60_000) } })
  expect(await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: [expiringItem.id], scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  })).toEqual({ error: 'INVALID' })
  const secondItem = await invitation()
  const thirdItem = await invitation()
  expect(await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: [secondItem.id, thirdItem.id], intervalMs: 40 * 60_000,
    scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  })).toEqual({ error: 'INVALID' })
  const approved = await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })
  expect(approved).toMatchObject({ campaign: { status: 'scheduled', scheduledAt } })
  const delivery = await DeliveryModel.findOne({ campaignId: planned.campaign.id })
  expect(delivery).toBeTruthy()
  expect(await core.listDispatchableDeliveryIds()).not.toContain(delivery.id)
  await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id }, { $set: { scheduledAt: new Date(0) } })
  expect(await core.listDispatchableDeliveryIds()).toContain(delivery.id)
  expect((await DeliveryCampaignModel.findById(planned.campaign.id)).status).toBe('running')
})

test('aprovação recusa agendamento vencido sem liberar outbox', async () => {
  const planned = await scheduledPlan()
  await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id }, { $set: { scheduledAt: new Date(0) } })
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })).toEqual({ error: 'CONFLICT' })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)
})

test('agendamento vencido limpa preparação parcial e permite reagendar sem duplicar', async () => {
  const invitations = [await invitation(), await invitation()]
  const scheduledAt = new Date(Date.now() + 30 * 60_000).toISOString()
  const planned = await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: invitations.map(item => item.id), intervalMs: 60_000, scheduledAt,
  })
  if (!('campaign' in planned)) throw new Error('Plano indisponível')
  let saves = 0
  const originalSave = DeliveryModel.prototype.save
  const save = vi.spyOn(DeliveryModel.prototype, 'save').mockImplementation(function (this: any, ...args: any[]) {
    saves++
    if (saves === 2) throw new Error('falha Mongo simulada')
    return originalSave.apply(this, args)
  })
  try {
    await expect(core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
      { approve: true, previewHash: planned.preview.previewHash })).rejects.toThrow('falha Mongo simulada')
  } finally { save.mockRestore() }
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(1)
  await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id }, { $set: { scheduledAt: new Date(0) } })
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })).toEqual({ error: 'CONFLICT' })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)

  const replacement = await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: invitations.map(item => item.id), intervalMs: 60_000,
    scheduledAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  })
  if (!('campaign' in replacement)) throw new Error('Reagendamento indisponível')
  expect(await core.approveDeliveryCampaign(org, eventId, replacement.campaign.id,
    { approve: true, previewHash: replacement.preview.previewHash }))
    .toMatchObject({ campaign: { status: 'scheduled' } })
  expect(await DeliveryModel.countDocuments({ campaignId: replacement.campaign.id })).toBe(2)
})

test('limpeza de rascunho não apaga outbox aprovada por transição concorrente', async () => {
  const planned = await scheduledPlan()
  const item = planned.preview.items[0]
  expect(await core.approveInitialDelivery(org, eventId, {
    invitationId: item.invitationId, approve: true, previewHash: item.previewHash,
  }, { campaignId: planned.campaign.id })).toHaveProperty('delivery')
  const delivery = await DeliveryModel.findOne({ campaignId: planned.campaign.id })
  await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id }, { $set: { scheduledAt: new Date(0) } })
  const original = DeliveryCampaignModel.findOneAndUpdate.bind(DeliveryCampaignModel)
  let won = false
  const update = vi.spyOn(DeliveryCampaignModel, 'findOneAndUpdate').mockImplementation(async (...args: any[]) => {
    if (!won && args[1]?.$set?.cancellationReason === 'invalidated_draft') {
      won = true
      await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id, status: 'draft' }, { $set: {
        status: 'running', approvalHash: planned.preview.previewHash, approvedAt: new Date(),
      } })
    }
    return original(...args)
  })
  try {
    expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
      { approve: true, previewHash: planned.preview.previewHash })).toEqual({ error: 'CONFLICT' })
  } finally { update.mockRestore() }
  expect(won).toBe(true)
  expect(await DeliveryCampaignModel.findById(planned.campaign.id)).toMatchObject({ status: 'running' })
  expect(await DeliveryModel.findById(delivery.id)).toMatchObject({ status: 'queued' })
})

test('reinício recupera outbox tardia de agendamento invalidado', async () => {
  const planned = await scheduledPlan()
  const item = planned.preview.items[0]
  expect(await core.approveInitialDelivery(org, eventId, {
    invitationId: item.invitationId, approve: true, previewHash: item.previewHash,
  }, { campaignId: planned.campaign.id })).toHaveProperty('delivery')
  await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id }, { $set: {
    status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'invalidated_draft',
  } })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(1)
  const replacement = await core.previewDeliveryCampaign(org, eventId, {
    invitationIds: [item.invitationId], intervalMs: 60_000,
    scheduledAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  })
  if (!('campaign' in replacement)) throw new Error('Reagendamento indisponível')
  expect(await core.approveDeliveryCampaign(org, eventId, replacement.campaign.id,
    { approve: true, previewHash: replacement.preview.previewHash }))
    .toMatchObject({ campaign: { status: 'scheduled' } })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)
  expect(await DeliveryModel.countDocuments({ campaignId: replacement.campaign.id })).toBe(1)
})

test('save atrasado após invalidar rascunho é limpo antes de a aprovação terminar', async () => {
  const planned = await scheduledPlan()
  let entered!: () => void
  let release!: () => void
  const saveEntered = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const originalSave = DeliveryModel.prototype.save
  const save = vi.spyOn(DeliveryModel.prototype, 'save').mockImplementation(async function (this: any, ...args: any[]) {
    entered()
    await gate
    return originalSave.apply(this, args)
  })
  const approval = core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })
  try {
    await saveEntered
    await DeliveryCampaignModel.updateOne({ _id: planned.campaign.id, status: 'draft' }, { $set: {
      status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'invalidated_draft',
    } })
    await DeliveryModel.deleteMany({ campaignId: planned.campaign.id })
    release()
    expect(await approval).toEqual({ error: 'CONFLICT' })
  } finally {
    release()
    await approval.catch(() => undefined)
    save.mockRestore()
  }
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)
})

test('aprovação é explícita, vinculada ao hash, atômica e idempotente sob concorrência', async () => {
  const planned = await plan(2)
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id, { approve: false, previewHash: planned.preview.previewHash }))
    .toEqual({ error: 'INVALID' })
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id, { approve: true, previewHash: '0'.repeat(64) }))
    .toEqual({ error: 'CONFLICT' })
  const approve = () => core.approveDeliveryCampaign(org, eventId, planned.campaign.id, { approve: true, previewHash: planned.preview.previewHash })
  const results = await Promise.all([approve(), approve()])
  expect(results).toEqual([expect.objectContaining({ campaign: expect.objectContaining({ status: 'running' }) }),
    expect.objectContaining({ campaign: expect.objectContaining({ status: 'running' }) })])
  const docs = await DeliveryModel.find({ campaignId: planned.campaign.id })
  expect(docs).toHaveLength(2)
  expect(docs.every(doc => doc.contentHash && doc.approvedMode === 'fake')).toBe(true)
  expect((await core.listDispatchableDeliveryIds()).filter(id => docs.some(doc => doc.id === id))).toHaveLength(2)
  const other = (await core.createOrganization({ name: 'Outra' })).id
  expect(await core.getDeliveryCampaign(other, eventId, planned.campaign.id)).toBeNull()
})

test('campanha Baileys aprovada envia somente texto e marca mídia como skipped', async () => {
  const campaign = await approved()
  const deliveryBeforeWorker = await DeliveryModel.findById(campaign.deliveries[0].id)
  expect(deliveryBeforeWorker).toMatchObject({ status: 'queued', media: { status: 'skipped' }, text: { status: 'pending' } })
  let renders = 0
  const deps = fakeDependencies()
  await core.processDelivery(campaign.deliveries[0].id, { ...deps, renderMedia: async () => {
    renders++
    throw new Error('campanha não deve renderizar mídia')
  } })
  const delivery = await DeliveryModel.findById(campaign.deliveries[0].id)
  expect(renders).toBe(0)
  expect(deps.sent).toEqual(['text'])
  expect(delivery).toMatchObject({ status: 'completed', media: { status: 'skipped' }, text: { status: 'accepted' } })
  expect(delivery.attempts.map((attempt: any) => attempt.part)).toEqual(['text'])
})

test('alteração após prévia invalida toda a aprovação e mantém outbox vazia', async () => {
  const planned = await plan(2)
  await GuestModel.updateOne({ _id: planned.invitations[1].guestId }, { $set: { whatsappOptedOutAt: new Date() } })
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id, { approve: true, previewHash: planned.preview.previewHash }))
    .toEqual({ error: 'CONFLICT' })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)
})

test('falha parcial prepara outbox bloqueada; repetição retoma sem duplicar', async () => {
  const planned = await plan(2)
  let saves = 0
  const originalSave = DeliveryModel.prototype.save
  const save = vi.spyOn(DeliveryModel.prototype, 'save').mockImplementation(function (this: any, ...args: any[]) {
    saves++
    if (saves === 2) throw new Error('falha Mongo simulada')
    return originalSave.apply(this, args)
  })
  try {
    await expect(core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
      { approve: true, previewHash: planned.preview.previewHash })).rejects.toThrow('falha Mongo simulada')
  } finally { save.mockRestore() }
  const staged = await DeliveryModel.findOne({ campaignId: planned.campaign.id })
  expect(staged).toBeTruthy()
  expect((await core.listDispatchableDeliveryIds()).includes(staged.id)).toBe(false)
  const deps = fakeDependencies()
  await core.processDelivery(staged.id, deps)
  expect(deps.sent).toHaveLength(0)
  expect((await DeliveryCampaignModel.findById(planned.campaign.id)).status).toBe('draft')
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })).toMatchObject({ campaign: { status: 'running' } })
  expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(2)
})

test('campanhas concorrentes e aprovação individual não podem apropriar a mesma entrega', async () => {
  const planned = await plan()
  const other = await core.previewDeliveryCampaign(org, eventId, { invitationIds: [planned.invitations[0].id], intervalMs: 5000 })
  if (!('campaign' in other)) throw new Error('Plano ausente')
  const results = await Promise.all([planned, other].map(item => core.approveDeliveryCampaign(org, eventId,
    item.campaign.id, { approve: true, previewHash: item.preview.previewHash })))
  expect(results.filter(result => 'campaign' in result)).toHaveLength(1)
  expect(results.filter(result => 'error' in result)).toEqual([{ error: 'CONFLICT' }])
  expect(await DeliveryModel.countDocuments({ invitationId: planned.invitations[0].id })).toBe(1)
  const preview = await core.previewInitialDelivery(org, eventId, planned.invitations[0].id)
  if (!('preview' in preview)) throw new Error('Prévia ausente')
  expect(await core.approveInitialDelivery(org, eventId, { invitationId: planned.invitations[0].id,
    approve: true, previewHash: preview.preview.previewHash })).toEqual({ error: 'CONFLICT' })
})

test('cadência persiste entre destinatários, workers concorrentes e pausa/retomada', async () => {
  const campaign = await approved(2)
  const deps = fakeDependencies()
  await Promise.all(campaign.deliveries.map(doc => core.processDelivery(doc.id, deps)))
  expect(deps.sent).toEqual(['text'])
  expect(await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)).toMatchObject({ campaign: { status: 'paused' } })
  expect((await core.listDispatchableDeliveryIds()).some(id => campaign.deliveries.some(doc => doc.id === id))).toBe(false)
  await Promise.all(campaign.deliveries.map(doc => core.processDelivery(doc.id, deps)))
  expect(deps.sent).toHaveLength(1)
  expect(await core.resumeDeliveryCampaign(org, eventId, campaign.campaign.id)).toMatchObject({ campaign: { status: 'running' } })
  await Promise.all(campaign.deliveries.map(doc => core.processDelivery(doc.id, deps)))
  expect(deps.sent).toHaveLength(1)
})

test('duas campanhas compartilham reserva atômica de cadência na conexão', async () => {
  const first = await approved()
  const second = await approved()
  const deliveries = [first.deliveries[0], second.deliveries[0]]
  const deps = fakeDependencies()
  const started = Date.now()
  await Promise.all(deliveries.map(delivery => core.processDelivery(delivery.id, deps)))
  expect(deps.sent).toHaveLength(1)
  const connection = await EvolutionConnectionModel.findById(connectionId)
  expect(connection.nextCampaignSendAt.getTime()).toBeGreaterThanOrEqual(started + 59_000)
  const current = await DeliveryModel.find({ _id: { $in: deliveries.map(delivery => delivery.id) } })
  const waiting = current.find(delivery => delivery.status !== 'completed')!
  await DeliveryModel.updateOne({ _id: waiting.id }, { $set: { nextAttemptAt: new Date(0) } })
  await DeliveryCampaignModel.updateOne({ _id: waiting.campaignId }, { $set: { nextSendAt: new Date(0) } })
  await core.processDelivery(waiting.id, deps)
  expect(deps.sent).toHaveLength(1)
  expect(await DeliveryModel.findById(waiting.id)).toMatchObject({ status: 'retry_wait', attempts: [] })
  await EvolutionConnectionModel.updateOne({ _id: connectionId }, { $set: { nextCampaignSendAt: new Date(0) } })
  await DeliveryModel.updateOne({ _id: waiting.id }, { $set: { nextAttemptAt: new Date(0) } })
  await DeliveryCampaignModel.updateOne({ _id: waiting.campaignId }, { $set: { nextSendAt: new Date(0) } })
  await core.processDelivery(waiting.id, deps)
  expect(deps.sent).toHaveLength(2)
})

test('pausa antes do provedor impede envio; resultado incerto de texto nunca repete', async () => {
  const campaign = await approved()
  const deps = fakeDependencies({ checkNumber: async phone => {
    await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)
    return { number: phone.slice(1), exists: true }
  } })
  await core.processDelivery(campaign.deliveries[0].id, deps)
  expect(deps.sent).toHaveLength(0)
  await core.resumeDeliveryCampaign(org, eventId, campaign.campaign.id)
  await DeliveryModel.updateMany({ campaignId: campaign.campaign.id }, { $set: { nextAttemptAt: new Date(0) } })
  let sends = 0
  const timeout = fakeDependencies({ sendText: async () => { sends++; throw new Error('timeout') } })
  await core.processDelivery(campaign.deliveries[0].id, timeout)
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe('uncertain')
  await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)
  await core.resumeDeliveryCampaign(org, eventId, campaign.campaign.id)
  await core.processDelivery(campaign.deliveries[0].id, timeout)
  expect(sends).toBe(1)
  expect((await core.getDeliveryCampaign(org, eventId, campaign.campaign.id)).campaign.counts.uncertain).toBe(1)
})

test('cancelamento definitivo bloqueia pendentes, preserva concluídos e permite tentativa já iniciada concluir', async () => {
  const campaign = await approved(2)
  const first = campaign.deliveries[0]
  const second = campaign.deliveries[1]
  const deps = fakeDependencies({ sendText: async () => {
    expect(await core.cancelDeliveryCampaign(org, eventId, campaign.campaign.id))
      .toMatchObject({ campaign: { status: 'cancelled', cancelledAt: expect.any(String) } })
    return { messageId: randomUUID(), status: 'sent' as const }
  } })
  await core.processDelivery(first.id, deps)
  expect(await DeliveryModel.findById(first.id)).toMatchObject({ status: 'completed', text: { status: 'accepted' } })
  expect(await DeliveryModel.findById(second.id)).toMatchObject({ status: 'suppressed', suppressionReason: 'campaign_cancelled' })
  expect(await core.listDispatchableDeliveryIds()).not.toContain(second.id)
  expect(await core.resumeDeliveryCampaign(org, eventId, campaign.campaign.id)).toEqual({ error: 'CONFLICT' })
  expect(await core.cancelDeliveryCampaign(org, eventId, campaign.campaign.id))
    .toMatchObject({ campaign: { status: 'cancelled' } })
})

test('campanha agendada pode ser cancelada antes do primeiro envio', async () => {
  const planned = await scheduledPlan()
  expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
    { approve: true, previewHash: planned.preview.previewHash })).toMatchObject({ campaign: { status: 'scheduled' } })
  const delivery = await DeliveryModel.findOne({ campaignId: planned.campaign.id })
  expect(await core.cancelDeliveryCampaign(org, eventId, planned.campaign.id))
    .toMatchObject({ campaign: { status: 'cancelled' } })
  const deps = fakeDependencies()
  await core.processDelivery(delivery.id, deps)
  expect(deps.sent).toHaveLength(0)
  expect(await DeliveryModel.findById(delivery.id)).toMatchObject({ status: 'suppressed', suppressionReason: 'campaign_cancelled' })
})

test('cancelamento concorrente com a criação da outbox suprime a entrega tardia', async () => {
  const planned = await plan()
  const originalSave = DeliveryModel.prototype.save
  let cancelled = false
  const save = vi.spyOn(DeliveryModel.prototype, 'save').mockImplementation(async function (this: any, ...args: any[]) {
    if (!cancelled) {
      cancelled = true
      await core.cancelDeliveryCampaign(org, eventId, planned.campaign.id)
    }
    return originalSave.apply(this, args)
  })
  try {
    expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
      { approve: true, previewHash: planned.preview.previewHash })).toEqual({ error: 'CONFLICT' })
  } finally { save.mockRestore() }
  expect(await DeliveryCampaignModel.findById(planned.campaign.id)).toMatchObject({ status: 'cancelled' })
  expect(await DeliveryModel.findOne({ campaignId: planned.campaign.id }))
    .toMatchObject({ status: 'suppressed', suppressionReason: 'campaign_cancelled' })
  expect(await core.listDispatchableDeliveryIds()).not.toContain(
    String((await DeliveryModel.findOne({ campaignId: planned.campaign.id })).id))
})

async function releaseCadence(campaignId: string) {
  await DeliveryCampaignModel.updateOne({ _id: campaignId }, { $set: { nextSendAt: new Date(0) } })
  await DeliveryModel.updateMany({ campaignId }, { $set: { nextAttemptAt: new Date(0) } })
  await EvolutionConnectionModel.updateMany({}, { $set: { nextCampaignSendAt: new Date(0) } })
}

test('cada destinatário respeita cadência e a campanha termina sem repetir aceite', async () => {
  const campaign = await approved(2)
  const deps = fakeDependencies()
  for (let count = 0; count < 2; count++) {
    await releaseCadence(campaign.campaign.id)
    await Promise.all(campaign.deliveries.map(doc => core.processDelivery(doc.id, deps)))
    expect(deps.sent).toHaveLength(count + 1)
  }
  const status = await core.getDeliveryCampaign(org, eventId, campaign.campaign.id)
  expect(status).toMatchObject({ campaign: { status: 'completed', counts: { completed: 2 } } })
  await Promise.all(campaign.deliveries.map(doc => core.processDelivery(doc.id, deps)))
  expect(deps.sent).toHaveLength(2)
})

test('opt-out e revogação antes do texto são revalidados', async () => {
  for (const revoke of [false, true]) {
    const campaign = await approved()
    const deps = fakeDependencies()
    if (revoke) await InvitationModel.updateOne({ _id: campaign.invitations[0].id }, { $set: { revokedAt: new Date() } })
    else await GuestModel.updateOne({ _id: campaign.invitations[0].guestId }, { $set: { whatsappOptedOutAt: new Date() } })
    await core.processDelivery(campaign.deliveries[0].id, deps)
    expect(deps.sent).toHaveLength(0)
    expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe('suppressed')
  }
})

test('pausa após reservar cadência e antes do provedor impede chamada efetiva', async () => {
  const campaign = await approved()
  const deps = fakeDependencies()
  const original = DeliveryModel.findOneAndUpdate.bind(DeliveryModel)
  let paused = false
  const update = vi.spyOn(DeliveryModel, 'findOneAndUpdate').mockImplementation(async (...args: any[]) => {
    const result = await original(...args)
    if (args[1]?.$set?.['text.status'] === 'sending') {
      await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)
      paused = true
    }
    return result
  })
  try { await core.processDelivery(campaign.deliveries[0].id, deps) }
  finally { update.mockRestore() }
  expect(paused).toBe(true)
  expect(deps.sent).toHaveLength(0)
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe('retry_wait')
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).attempts[0].outcome).toBe('retry_wait')
  expect((await EvolutionConnectionModel.findById(connectionId)).nextCampaignSendAt).toBeUndefined()
  const other = await approved()
  await core.processDelivery(other.deliveries[0].id, deps)
  expect(deps.sent).toEqual(['text'])
})

test('estado legado de mídia em sending vira skipped e não impede o texto', async () => {
  const campaign = await approved()
  const id = campaign.deliveries[0].id
  await DeliveryModel.updateOne({ _id: id }, { $set: { status: 'processing', leaseUntil: new Date(0), 'media.status': 'sending' } })
  const deps = fakeDependencies()
  await core.processDelivery(id, deps)
  expect(deps.sent).toEqual(['text'])
  expect(await DeliveryModel.findById(id)).toMatchObject({
    status: 'completed', media: { status: 'skipped' }, text: { status: 'accepted' },
  })
})

test('retomada de campanha não reintroduz mídia pendente de estado legado', async () => {
  const campaign = await approved()
  const id = campaign.deliveries[0].id
  await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)
  await DeliveryModel.updateOne({ _id: id }, { $set: {
    status: 'retry_wait', nextAttemptAt: new Date(0), 'media.status': 'retry_wait', 'text.status': 'pending',
  } })
  await core.resumeDeliveryCampaign(org, eventId, campaign.campaign.id)
  const deps = fakeDependencies()
  await core.processDelivery(id, deps)
  expect(deps.sent).toEqual(['text'])
  expect(await DeliveryModel.findById(id)).toMatchObject({
    status: 'completed', media: { status: 'skipped' }, text: { status: 'accepted' },
  })
})

test('Baileys revalida existência antes do texto e suprime somente ausência confirmada', async () => {
  const campaign = await approved()
  let checks = 0
  const deps = fakeDependencies({ checkNumber: async phone => {
    checks++
    return { number: phone.slice(1), exists: false }
  } })
  await core.processDelivery(campaign.deliveries[0].id, deps)
  expect(checks).toBe(1)
  expect(deps.sent).toHaveLength(0)
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).suppressionReason).toBe('number_not_registered')
  expect((await GuestModel.findById(campaign.invitations[0].guestId)).whatsappConsent).toBe(true)
})

test('falha, resposta inválida e quota da checagem Baileys adiam sem marcar inexistência', async () => {
  for (const checkNumber of [
    async () => { throw new Error('indisponível') },
    async () => ({ number: 'outro_numero', exists: false }),
    async () => { throw new EvolutionHttpError(429, 120_000) },
  ]) {
    const campaign = await approved()
    const deps = fakeDependencies({ checkNumber })
    const started = Date.now()
    await core.processDelivery(campaign.deliveries[0].id, deps)
    const doc = await DeliveryModel.findById(campaign.deliveries[0].id)
    expect(doc.status).toBe('retry_wait')
    expect(doc.suppressionReason).toBeUndefined()
    expect(doc.attempts).toHaveLength(0)
    expect(doc.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(started + 60_000)
    expect(deps.sent).toHaveLength(0)
  }
})

test('worker compartilha a quota por minuto com a consulta administrativa e adia sem enviar', async () => {
  const campaign = await approved()
  for (let index = 0; index < 10; index++) {
    expect(await core.checkEvolutionNumber(org, connectionId, `+55679999998${String(index).padStart(2, '0')}`))
      .toHaveProperty('exists', true)
  }
  const checkNumber = vi.fn(async (phone: string) => ({ number: phone.slice(1), exists: true }))
  const deps = fakeDependencies({ checkNumber })
  await core.processDelivery(campaign.deliveries[0].id, deps)
  const delivery = await DeliveryModel.findById(campaign.deliveries[0].id)
  expect(checkNumber).not.toHaveBeenCalled()
  expect(deps.sent).toHaveLength(0)
  expect(delivery).toMatchObject({ status: 'retry_wait', attempts: [] })
  expect(delivery.suppressionReason).toBeUndefined()
})

test('worker respeita quota diária mesmo com cache positivo e alimenta cache após consulta fresca', async () => {
  const firstCampaign = await approved()
  const phone = firstCampaign.deliveries[0].recipientPhone
  const checkNumber = vi.fn(async (number: string) => ({ number: number.slice(1), exists: true }))
  const deps = fakeDependencies({ checkNumber })
  await core.processDelivery(firstCampaign.deliveries[0].id, deps)
  expect(checkNumber).toHaveBeenCalledTimes(1)
  expect(await core.checkEvolutionNumber(org, connectionId, phone)).toMatchObject({ exists: true, cached: true })
  const day = Math.floor(Date.now() / 86_400_000)
  await LoginAttemptModel.updateOne({ _id: `evolution-number-day:${org}:${day}` }, { $set: { count: 100 } })
  const secondCampaign = await approved()
  const started = Date.now()
  await core.processDelivery(secondCampaign.deliveries[0].id, deps)
  const delivery = await DeliveryModel.findById(secondCampaign.deliveries[0].id)
  expect(checkNumber).toHaveBeenCalledTimes(1)
  expect(deps.sent).toEqual(['text'])
  expect(delivery.status).toBe('retry_wait')
  expect(delivery.suppressionReason).toBeUndefined()
  expect(delivery.attempts).toHaveLength(0)
  expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(started + 60_000)
})

test('pausa ou opt-out durante a checagem impedem envio após resposta positiva', async () => {
  for (const pause of [false, true]) {
    const campaign = await approved()
    const deps = fakeDependencies({ checkNumber: async phone => {
      if (pause) await core.pauseDeliveryCampaign(org, eventId, campaign.campaign.id)
      else await GuestModel.updateOne({ _id: campaign.invitations[0].guestId }, { $set: { whatsappOptedOutAt: new Date() } })
      return { number: phone.slice(1), exists: true }
    } })
    await core.processDelivery(campaign.deliveries[0].id, deps)
    expect(deps.sent).toHaveLength(0)
    expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe(pause ? 'retry_wait' : 'suppressed')
  }
})

test('prévia de 200 destinatários usa leituras compartilhadas de evento e template', async () => {
  const guests = await GuestModel.insertMany(Array.from({ length: 200 }, (_, index) => ({
    organizationId: org, name: `Pessoa de benchmark ${index}`, phone: '+5567999999999', whatsappConsent: true,
    whatsappAuthorization: { source: 'Formulário presencial assinado', confirmedBy: 'a'.repeat(24), confirmedAt: new Date() },
  })))
  const invitations = await Promise.all(guests.map(guest => core.createInvitation(org, eventId, { guestId: guest.id })))
  const ids = invitations.map(result => {
    if (!('invitation' in result)) throw new Error('Convite indisponível')
    return result.invitation.id
  })
  const eventRead = vi.spyOn(EventModel, 'findOne')
  const templateRead = vi.spyOn(TemplateVersionModel, 'findOne')
  const templateBatch = vi.spyOn(TemplateVersionModel, 'find')
  try {
    const start = performance.now()
    const result = await core.previewDeliveryCampaign(org, eventId, { invitationIds: ids })
    const elapsedMs = Math.round(performance.now() - start)
    expect(result).toMatchObject({ campaign: { recipientCount: 200 }, preview: { items: expect.any(Array) } })
    const templateReads = templateRead.mock.calls.length + templateBatch.mock.calls.length
    console.info(`campaign_preview_200 elapsedMs=${elapsedMs} eventReads=${eventRead.mock.calls.length} templateReads=${templateReads}`)
    expect(eventRead.mock.calls.length).toBeLessThanOrEqual(2)
    expect(templateReads).toBeLessThanOrEqual(2)
    if (!('preview' in result)) throw new Error('Prévia indisponível')
    const individual = await core.previewInitialDelivery(org, eventId, ids[0])
    expect(individual).toHaveProperty('preview.previewHash', result.preview.items.find(item => item.invitationId === ids[0])!.previewHash)
  } finally { eventRead.mockRestore(); templateRead.mockRestore(); templateBatch.mockRestore() }
})

test('versão publicada nova invalida hash mesmo quando texto e arte são idênticos', async () => {
  const planned = await plan()
  const version = await TemplateVersionModel.findOne({ eventId, version: 1 })
  await TemplateVersionModel.create({ organizationId: org, eventId, version: 2,
    sourceDraftRevision: 2, sourceEventUpdatedAt: version.sourceEventUpdatedAt, template: version.template, event: version.event })
  await EventModel.updateOne({ _id: eventId }, { $set: { amendmentVersion: 2 } })
  try {
    const reopened = await core.getDeliveryCampaignPreview(org, eventId, planned.campaign.id)
    expect('error' in reopened ? reopened.error : 'unexpected_preview').toBe('CONFLICT')
    expect(await core.approveDeliveryCampaign(org, eventId, planned.campaign.id,
      { approve: true, previewHash: planned.preview.previewHash })).toEqual({ error: 'CONFLICT' })
    expect(await DeliveryModel.countDocuments({ campaignId: planned.campaign.id })).toBe(0)
  } finally { await EventModel.updateOne({ _id: eventId }, { $set: { amendmentVersion: 0 } }) }
})

test('mudança do modo invalida aprovação fake sem chamar transporte', async () => {
  const campaign = await approved()
  const previousMode = process.env.EVOLUTION_MODE
  process.env.EVOLUTION_MODE = 'real'
  const deps = fakeDependencies()
  try { await core.processDelivery(campaign.deliveries[0].id, deps) }
  finally { process.env.EVOLUTION_MODE = previousMode }
  expect(deps.sent).toHaveLength(0)
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe('suppressed')
})

test('cancelamento do evento antes do worker suprime campanha sem envio', async () => {
  const campaign = await approved()
  await EventModel.updateOne({ _id: eventId }, { $set: { status: 'cancelled' } })
  const deps = fakeDependencies()
  await core.processDelivery(campaign.deliveries[0].id, deps)
  expect(deps.sent).toHaveLength(0)
  expect((await DeliveryModel.findById(campaign.deliveries[0].id)).status).toBe('suppressed')
})
