import { createHash, randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { cancelEvent, createEvent, createInvitation, getInvitationLink, getPublicInvitation, publishTemplate,
  revisePublishedEvent, saveTemplateDraft, submitRsvp } from '../../packages/core/src/index'
import { connectDatabase, DeliveryModel, EventModel, GuestModel, InvitationModel, migrateDeliveryIndexes,
  OrganizationModel, TemplateVersionModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.INVITE_LINK_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m07-event`).digest('base64')
let organizationId: string
let guestId: string

beforeAll(async () => {
  await connectDatabase()
  organizationId = String((await OrganizationModel.create({ name: 'Evento M07' }))._id)
  guestId = String((await GuestModel.create({ organizationId, name: 'Ana', phone: '+5567888888888',
    whatsappConsent: true, whatsappAuthorization: {
      source: 'Formulário presencial assinado', confirmedBy: 'a'.repeat(24), confirmedAt: new Date(),
    } }))._id)
})

afterAll(async () => {
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
})

test('revisão explícita atualiza convite e cancelamento fecha GET e RSVP', async () => {
  const event = await createEvent(organizationId, {
    name: 'Festa original', location: 'Jardim', address: 'Rua A',
    startsAt: '2027-01-02T20:00:00-04:00', endsAt: '2027-01-03T02:00:00-04:00',
    rsvpDeadline: '2027-01-01T20:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 2, companionNamesRequired: true,
  })
  expect(await saveTemplateDraft(organizationId, event.id, defaultTemplate)).toEqual(defaultTemplate)
  expect('publication' in await publishTemplate(organizationId, event.id, async () => true)).toBe(true)
  const issued = await createInvitation(organizationId, event.id, { guestId })
  expect('link' in issued).toBe(true)
  if (!('link' in issued)) return
  const token = issued.link.split('/').pop()!
  expect((await getPublicInvitation(token))?.event.location).toBe('Jardim')
  const revised = await revisePublishedEvent(organizationId, event.id, { expectedRevision: 0,
    changes: { location: 'Salão novo', address: 'Rua B' } })
  expect('event' in revised).toBe(true)
  if (!('event' in revised)) return
  expect(revised.event).toMatchObject({ revision: 1, changeVersion: 1, amendmentVersion: 2 })
  expect((await getPublicInvitation(token))?.event.location).toBe('Salão novo')
  expect((await InvitationModel.findById(issued.invitation.id)).templateVersion).toBe(1)
  expect(await revisePublishedEvent(organizationId, event.id, { expectedRevision: 0,
    changes: { location: 'Conflito' } })).toEqual({ error: 'CONFLICT' })
  expect('event' in await cancelEvent(organizationId, event.id, { expectedRevision: 1 })).toBe(true)
  expect(await getPublicInvitation(token)).toBeNull()
  expect(await submitRsvp(token, { status: 'accepted', companions: [], expectedVersion: 0 })).toEqual({ error: 'NOT_FOUND' })
  expect((await InvitationModel.findById(issued.invitation.id)).revokedAt).toBeTruthy()
  expect(await publishTemplate(organizationId, event.id, async () => true)).toEqual({ error: 'CONFLICT' })
})

test('revisão sincroniza prazo e validade somente nos convites ativos da organização', async () => {
  const now = Date.now()
  const startsAt = new Date(now + 7 * 86_400_000)
  const oldEndsAt = new Date(now + 10 * 86_400_000)
  const newEndsAt = new Date(now + 8 * 86_400_000)
  const oldDeadline = new Date(now + 6 * 86_400_000)
  const newDeadline = new Date(now - 60_000)
  const shorterExpiry = new Date(now + 4 * 86_400_000)
  const event = await createEvent(organizationId, {
    name: 'Festival de Exemplo', location: 'Zingara', address: 'Rua Exemplo, 123',
    startsAt: startsAt.toISOString(), endsAt: oldEndsAt.toISOString(),
    rsvpDeadline: oldDeadline.toISOString(), timeZone: 'America/Campo_Grande',
    companionLimit: 0, companionNamesRequired: false,
  })
  await saveTemplateDraft(organizationId, event.id, defaultTemplate)
  expect(await publishTemplate(organizationId, event.id, async () => true)).toHaveProperty('publication')

  const accepted = await createInvitation(organizationId, event.id, { guestId })
  if (!('link' in accepted)) throw new Error('Convite principal não emitido')
  const token = accepted.link.split('/').pop()!
  expect(await submitRsvp(token, { status: 'accepted', companions: [], expectedVersion: 0 }))
    .toHaveProperty('response.status', 'accepted')

  const makeGuest = async (name: string, phone: string, tenant = organizationId) => String((await GuestModel.create({
    organizationId: tenant, name, phone, whatsappConsent: false,
  }))._id)
  const shorterGuest = await makeGuest('Bia', '+5567999999991')
  const shorter = await createInvitation(organizationId, event.id, { guestId: shorterGuest,
    expiresAt: shorterExpiry.toISOString() })
  if (!('invitation' in shorter)) throw new Error('Convite curto não emitido')
  const revokedGuest = await makeGuest('Clara', '+5567999999992')
  const revoked = await createInvitation(organizationId, event.id, { guestId: revokedGuest })
  if (!('invitation' in revoked)) throw new Error('Convite revogado não emitido')
  const revokedAt = new Date(now - 30_000)
  await InvitationModel.updateOne({ _id: revoked.invitation.id }, { $set: { revokedAt } })

  const otherOrganizationId = String((await OrganizationModel.create({ name: 'Outra organização' }))._id)
  const otherGuest = await makeGuest('Dora', '+595971111111', otherOrganizationId)
  const other = await InvitationModel.create({ organizationId: otherOrganizationId, eventId: event.id,
    guestId: otherGuest, templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'outro-token',
    expiresAt: oldEndsAt, rsvpDeadline: oldDeadline, companionLimit: 0,
    companionNamesRequired: false, responseStatus: 'pending' })

  const before = await InvitationModel.findById(accepted.invitation.id)
  const historyBefore = JSON.parse(JSON.stringify(before?.history))
  const existingLink = await getInvitationLink(organizationId, event.id, accepted.invitation.id)
  const revised = await revisePublishedEvent(organizationId, event.id, { expectedRevision: 0, changes: {
    startsAt: startsAt.toISOString(), endsAt: newEndsAt.toISOString(), rsvpDeadline: newDeadline.toISOString(),
  } })
  expect(revised).toHaveProperty('event.rsvpDeadline', newDeadline.toISOString())
  expect(revised).toHaveProperty('event.endsAt', newEndsAt.toISOString())

  const activeAfter = await InvitationModel.findById(accepted.invitation.id)
  expect(activeAfter).toMatchObject({ responseStatus: 'accepted', responseVersion: 1 })
  expect(activeAfter?.rsvpDeadline.toISOString()).toBe(newDeadline.toISOString())
  expect(activeAfter?.expiresAt.toISOString()).toBe(newEndsAt.toISOString())
  expect(activeAfter?.secretHash).toBe(before?.secretHash)
  expect(JSON.parse(JSON.stringify(activeAfter?.history))).toEqual(historyBefore)
  expect(await getInvitationLink(organizationId, event.id, accepted.invitation.id)).toEqual(existingLink)
  expect((await getPublicInvitation(token))?.rsvpDeadline).toBe(newDeadline.toISOString())
  expect(await submitRsvp(token, { status: 'declined', companions: [], expectedVersion: 1 }))
    .toEqual({ error: 'DEADLINE' })

  expect((await InvitationModel.findById(shorter.invitation.id))?.expiresAt.toISOString())
    .toBe(shorterExpiry.toISOString())
  expect((await InvitationModel.findById(revoked.invitation.id))?.rsvpDeadline.toISOString())
    .toBe(oldDeadline.toISOString())
  expect((await InvitationModel.findById(other.id))?.rsvpDeadline.toISOString())
    .toBe(oldDeadline.toISOString())
  expect((await TemplateVersionModel.findOne({ eventId: event.id, version: 2 }))?.event.rsvpDeadline)
    .toBe(newDeadline.toISOString())

  // Simula uma emissão concorrente por uma instância antiga, concluída após a sincronização da revisão.
  await InvitationModel.updateOne({ _id: accepted.invitation.id }, { $set: {
    rsvpDeadline: oldDeadline, expiresAt: oldEndsAt,
  } })
  expect(await getPublicInvitation(token)).toMatchObject({
    rsvpDeadline: newDeadline.toISOString(), expiresAt: newEndsAt.toISOString(),
  })
  expect(await submitRsvp(token, { status: 'declined', companions: [], expectedVersion: 1 }))
    .toEqual({ error: 'DEADLINE' })
  await InvitationModel.updateOne({ _id: accepted.invitation.id }, { $set: {
    rsvpDeadline: newDeadline, expiresAt: newEndsAt,
  } })

  const versionsBeforeInvalid = await TemplateVersionModel.countDocuments({ eventId: event.id })
  expect(await revisePublishedEvent(organizationId, event.id, { expectedRevision: 1,
    changes: { rsvpDeadline: new Date(startsAt.getTime() + 1).toISOString() } }))
    .toEqual({ error: 'INVALID' })
  expect(await revisePublishedEvent(organizationId, event.id, { expectedRevision: 0,
    changes: { location: 'Conflito' } })).toEqual({ error: 'CONFLICT' })
  expect(await TemplateVersionModel.countDocuments({ eventId: event.id })).toBe(versionsBeforeInvalid)
  expect((await EventModel.findById(event.id))?.revision).toBe(1)
  expect((await InvitationModel.findById(accepted.invitation.id))?.rsvpDeadline.toISOString())
    .toBe(newDeadline.toISOString())

  const compatible = await revisePublishedEvent(organizationId, event.id, { expectedRevision: 1,
    changes: { location: 'Rua Exemplo, 123' } })
  expect(compatible).toHaveProperty('event.rsvpDeadline', newDeadline.toISOString())
  expect((await InvitationModel.findById(accepted.invitation.id))?.rsvpDeadline.toISOString())
    .toBe(newDeadline.toISOString())
})

test('migra índice M06 legado sem bloquear múltiplas automações', async () => {
  const name = 'invitationId_1_type_1_templateVersion_1'
  await DeliveryModel.collection.dropIndex(name)
  await DeliveryModel.collection.createIndex({ invitationId: 1, type: 1, templateVersion: 1 }, { unique: true })
  await migrateDeliveryIndexes()
  const indexes = await DeliveryModel.collection.indexes()
  expect(indexes.find(index => index.name === name)?.partialFilterExpression).toEqual({ type: 'initial' })
})
