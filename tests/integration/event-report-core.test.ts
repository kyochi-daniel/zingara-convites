import { randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { listInvitations } from '../../packages/core/src/index.ts'
import { getEventReport } from '../../packages/core/src/event-report.ts'
import {
  connectDatabase,
  DeliveryModel,
  EventModel,
  GuestModel,
  InvitationModel,
  OrganizationModel,
} from '../../packages/database/src/index.ts'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_event_report_core_${randomUUID().replaceAll('-', '').slice(0, 8)}`
process.env.MONGODB_URI = uri.toString()

let organizationId: string
let eventId: string
let phoneSequence = 0

beforeAll(async () => {
  await connectDatabase()
  organizationId = (await OrganizationModel.create({ name: 'Relatório' })).id
  eventId = (await EventModel.create({
    organizationId,
    name: 'Casamento',
    location: 'Jardim',
    address: 'Rua A',
    status: 'published',
    startsAt: new Date('2027-03-02T20:00:00.000Z'),
    endsAt: new Date('2027-03-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-03-01T20:00:00.000Z'),
    timeZone: 'America/Campo_Grande',
    companionLimit: 4,
    companionNamesRequired: true,
  })).id
})

afterAll(async () => {
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
})

async function createInvitation(name: string, tags: string[]) {
  const guest = await GuestModel.create({
    organizationId,
    name,
    phone: `+5567${String(++phoneSequence).padStart(9, '0')}`,
    tags,
  })
  return InvitationModel.create({
    organizationId,
    eventId,
    guestId: guest._id,
    templateVersion: 1,
    secretHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    secretCiphertext: 'segredo-cifrado',
    expiresAt: new Date('2027-03-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-03-01T20:00:00.000Z'),
    companionLimit: 4,
    companionNamesRequired: true,
  })
}

test('totais de convites ignoram somente a etiqueta exata teste-zingara', async () => {
  await createInvitation('Convidado real', [])
  await createInvitation('Teste marcado', ['teste-zingara'])
  await createInvitation('Etiqueta parecida', ['prefixo-teste-zingara'])

  const result = await listInvitations(organizationId, eventId)

  expect(result?.items).toHaveLength(3)
  expect(result?.totals).toEqual({ pending: 2, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 })
})

test('relatório agrega mensagens reais e RSVP sem teste, duplicação ou mistura de tenant', async () => {
  const reportEvent = await EventModel.create({
    organizationId,
    name: 'Evento do relatório',
    location: 'Salão',
    address: 'Rua B',
    status: 'published',
    startsAt: new Date('2027-04-02T20:00:00.000Z'),
    endsAt: new Date('2027-04-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-04-01T20:00:00.000Z'),
    timeZone: 'America/Campo_Grande',
    companionLimit: 4,
    companionNamesRequired: true,
  })
  const confirmedGuests = await GuestModel.insertMany(Array.from({ length: 105 }, (_, index) => ({
    organizationId,
    name: `Pessoa ${String(index).padStart(3, '0')}`,
    phone: `+5568${String(index + 1).padStart(9, '0')}`,
    tags: [],
  })))
  const confirmedInvitations = await InvitationModel.insertMany(confirmedGuests.map((guest, index) => ({
    organizationId,
    eventId: reportEvent._id,
    guestId: guest._id,
    templateVersion: 1,
    secretHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    secretCiphertext: `ciphertext-${index}`,
    expiresAt: new Date('2027-04-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-04-01T20:00:00.000Z'),
    companionLimit: 4,
    companionNamesRequired: true,
    responseStatus: 'accepted',
    companions: index === 0 ? ['A', 'B'] : index === 1 ? ['C'] : [],
  })))

  const extraGuests = await GuestModel.insertMany([
    { organizationId, name: 'Pendente', phone: '+5568999999901', tags: [] },
    { organizationId, name: 'Recusado', phone: '+5568999999902', tags: [] },
    { organizationId, name: 'Revogado', phone: '+5568999999903', tags: [] },
    { organizationId, name: 'Teste real', phone: '+5568999999904', tags: ['teste-zingara'] },
    { organizationId, name: 'Etiqueta parecida', phone: '+5568999999905', tags: ['teste-zingara-extra'] },
  ])
  const extraInvitations = await InvitationModel.insertMany(extraGuests.map((guest, index) => ({
    organizationId,
    eventId: reportEvent._id,
    guestId: guest._id,
    templateVersion: 1,
    secretHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    secretCiphertext: `extra-ciphertext-${index}`,
    expiresAt: new Date('2027-04-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-04-01T20:00:00.000Z'),
    companionLimit: 4,
    companionNamesRequired: true,
    responseStatus: index === 1 ? 'declined' : index === 2 || index === 3 ? 'accepted' : 'pending',
    companions: [],
    ...(index === 2 ? { revokedAt: new Date('2026-10-19T10:00:00.000Z') } : {}),
  })))

  const otherOrganization = await OrganizationModel.create({ name: 'Outro tenant' })
  const foreignGuest = await GuestModel.create({
    organizationId: otherOrganization._id,
    name: 'Convidado estrangeiro',
    phone: '+5568999999910',
    tags: [],
  })
  const foreignInvitation = await InvitationModel.create({
    organizationId,
    eventId: reportEvent._id,
    guestId: foreignGuest._id,
    templateVersion: 1,
    secretHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    secretCiphertext: 'foreign-ciphertext',
    expiresAt: new Date('2027-04-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-04-01T20:00:00.000Z'),
    companionLimit: 4,
    companionNamesRequired: true,
    responseStatus: 'accepted',
  })
  const orphanGuest = await GuestModel.create({ organizationId, name: 'Órfão', phone: '+5568999999911', tags: [] })
  const orphanInvitation = await InvitationModel.create({
    organizationId,
    eventId: reportEvent._id,
    guestId: orphanGuest._id,
    templateVersion: 1,
    secretHash: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
    secretCiphertext: 'orphan-ciphertext',
    expiresAt: new Date('2027-04-03T02:00:00.000Z'),
    rsvpDeadline: new Date('2027-04-01T20:00:00.000Z'),
    companionLimit: 4,
    companionNamesRequired: true,
    responseStatus: 'accepted',
  })
  await GuestModel.deleteOne({ _id: orphanGuest._id })

  const connectionId = reportEvent._id
  const delivery = (invitation: any, guest: any, options: {
    mode?: 'fake' | 'real'
    type?: 'initial' | 'automation'
    textStatus?: string
    receiptStatus?: string
    receiptRank?: number
    templateVersion?: number
    approvedAt?: Date
    guestId?: unknown
  } = {}) => ({
    organizationId,
    eventId: reportEvent._id,
    invitationId: invitation._id,
    guestId: options.guestId ?? guest._id,
    type: options.type ?? 'initial',
    ...(options.type === 'automation' ? {
      automationRuleId: otherOrganization._id,
      automationRevision: 1,
      automationOccurrence: randomUUID(),
    } : {}),
    templateVersion: options.templateVersion ?? 1,
    contentHash: randomUUID().replaceAll('-', ''),
    approvedMode: options.mode ?? 'real',
    approvedConnectionId: connectionId,
    approvedConnectionServerUrl: 'https://evolution.example.test',
    approvedConnectionTokenHash: 'a'.repeat(64),
    approvedProvider: 'evolution',
    approvedChannel: 'baileys',
    status: options.textStatus === 'failed_permanent' ? 'failed_permanent' : 'completed',
    media: { status: 'skipped' },
    text: {
      status: options.textStatus ?? 'accepted',
      ...(options.receiptStatus ? { receiptStatus: options.receiptStatus } : {}),
      ...(options.receiptRank === undefined ? {} : { receiptRank: options.receiptRank }),
    },
    attempts: [],
    recipientPhone: guest.phone,
    approvedAt: options.approvedAt ?? new Date('2026-10-19T12:00:00.000Z'),
  })
  await DeliveryModel.insertMany([
    delivery(confirmedInvitations[0], confirmedGuests[0], { receiptStatus: 'Delivered', receiptRank: 2 }),
    delivery(confirmedInvitations[1], confirmedGuests[1], { receiptStatus: 'Read', receiptRank: 3 }),
    delivery(confirmedInvitations[2], confirmedGuests[2], { receiptStatus: 'Played', receiptRank: 4 }),
    delivery(confirmedInvitations[3], confirmedGuests[3], { receiptStatus: 'Sent', receiptRank: 1 }),
    delivery(confirmedInvitations[4], confirmedGuests[4], { receiptStatus: 'Unknown', receiptRank: 0 }),
    delivery(confirmedInvitations[5], confirmedGuests[5]),
    delivery(confirmedInvitations[6], confirmedGuests[6], { textStatus: 'failed_permanent' }),
    delivery(confirmedInvitations[7], confirmedGuests[7], {
      receiptStatus: 'Read', receiptRank: 3, approvedAt: new Date('2026-10-19T11:00:00.000Z'),
    }),
    delivery(confirmedInvitations[7], confirmedGuests[7], {
      receiptStatus: 'Sent', receiptRank: 1, templateVersion: 2,
      approvedAt: new Date('2026-10-19T13:00:00.000Z'),
    }),
    delivery(confirmedInvitations[8], confirmedGuests[8], { mode: 'fake' }),
    delivery(confirmedInvitations[9], confirmedGuests[9], { type: 'automation' }),
    delivery(extraInvitations[3], extraGuests[3], { receiptStatus: 'Read', receiptRank: 3 }),
    delivery(foreignInvitation, foreignGuest, { receiptStatus: 'Read', receiptRank: 3 }),
    delivery(orphanInvitation, orphanGuest, { receiptStatus: 'Read', receiptRank: 3 }),
    delivery(confirmedInvitations[10], confirmedGuests[10], {
      guestId: foreignGuest._id, receiptStatus: 'Read', receiptRank: 3,
    }),
  ])

  const result = await getEventReport(organizationId, reportEvent.id)

  expect(result).not.toBeNull()
  expect(result?.eventId).toBe(reportEvent.id)
  expect(result?.eventName).toBe('Evento do relatório')
  expect(Number.isNaN(Date.parse(result?.generatedAt ?? ''))).toBe(false)
  expect(result?.messages).toEqual({
    total: 8,
    accepted: 7,
    delivered: 4,
    read: 3,
    awaitingDelivery: 3,
    failed: 1,
  })
  expect(result?.rsvp).toEqual({ pending: 2, accepted: 105, declined: 1, revoked: 1, peopleConfirmed: 108 })
  expect(result?.confirmed).toHaveLength(105)
  expect(result?.confirmed[0]).toEqual({
    invitationId: confirmedInvitations[0]!.id,
    guestId: confirmedGuests[0]!.id,
    name: 'Pessoa 000',
    phone: '+5568000000001',
    peopleCount: 3,
  })
  expect(result?.confirmed.map(item => item.name)).toEqual(
    [...(result?.confirmed ?? [])].map(item => item.name).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  )
  const serialized = JSON.stringify(result)
  expect(serialized).not.toContain('secretHash')
  expect(serialized).not.toContain('secretCiphertext')
  expect(serialized).not.toContain('ciphertext-')
  expect(serialized).not.toContain('recipientPhone')
  expect(serialized).not.toContain('contentHash')
})

test('relatório exige IDs válidos e respeita o escopo do evento', async () => {
  const otherOrganization = await OrganizationModel.create({ name: 'Escopo' })
  expect(await getEventReport('inválido', eventId)).toBeNull()
  expect(await getEventReport(otherOrganization.id, eventId)).toBeNull()
})
