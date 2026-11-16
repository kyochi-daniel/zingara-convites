import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { NumberVerificationModel } from '@zingara/database'
import { evolutionNumberPreviewInput, evolutionNumberVerificationInput, type EvolutionNumberPreview } from '@zingara/contracts'
import { jwtVerify, SignJWT } from 'jose'
import { createEvolutionClient, createEvolutionInstallationClient, proveEvolutionInstance, validateEvolutionInstallationOrigin, EvolutionHttpError, type EvolutionClient } from '@zingara/integrations'
import { csvImportInput, csvPreviewInput, defaultTemplate, deliveryApprovalInput, eventCancelInput, eventInput, eventPatch, eventRevisionInput, eventTemplateValues, evolutionBindInput, evolutionConnectionInput, evolutionInstallationInput, guestInput, guestListQuery, guestPatch, invitationCreateInput, listQuery, loginInput, officialTemplateInput, organizationInput, organizationPatch, renderEventMessage, rsvpInput, sanitizeAssistantPending, sanitizeAssistantText, templateInput, type AssistantDecision, type AssistantNavigation, type AssistantProposal, type DeliveryApprovalInput, type EventInput, type EvolutionBindInput, type EvolutionConnectionInput, type EvolutionInstallationInput, type GuestInput, type GuestListQuery, type InvitationCreateInput, type ListQuery, type OrganizationInput, type RsvpInput, type TemplateInput, type TemplateVariable } from '@zingara/contracts'
import { AdminModel, AssistantConversationModel, connectDatabase, DeliveryCampaignModel, DeliveryModel, EventModel, EvolutionConnectionModel, EvolutionInstallationModel, EvolutionTemplateModel, GuestModel, GuestImportBatchModel, GuestImportPhoneModel, InvitationModel, LoginAttemptModel, OrganizationModel, SessionModel, TemplateVersionModel, WebhookInboxModel } from '@zingara/database'
import { guestFileImportInput, type GuestFileImportInput } from '@zingara/contracts'
import { parseContactFile, type ContactFile } from './contact-import.ts'
import { refreshDeliveryCampaign } from './campaign-state.ts'

const SESSION_MS = 2 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id })

function jwtSettings() {
  const secret = process.env.JWT_SECRET
  const issuer = process.env.JWT_ISSUER
  const audience = process.env.JWT_AUDIENCE
  if (!secret || secret.length < 32 || !issuer || !audience) throw new Error('Configuração JWT incompleta')
  return { key: new TextEncoder().encode(secret), issuer, audience }
}

export async function bootstrapAdmin(email: string, password: string) {
  const parsed = loginInput.safeParse({ email, password })
  if (!parsed.success || password.length < 12) throw new Error('Email ou senha de bootstrap inválidos')
  await connectDatabase()
  if (await AdminModel.exists({ _id: 'global' })) return false
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
  try {
    await AdminModel.create({ _id: 'global', email: email.toLowerCase(), passwordHash })
    return true
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false
    throw error
  }
}

export async function loginAdmin(email: string, password: string, sourceIp: string) {
  await connectDatabase()
  const window = Math.floor(Date.now() / LOGIN_WINDOW_MS)
  const bucketExpiresAt = new Date((window + 2) * LOGIN_WINDOW_MS)
  const transportKey = `transport:${createHash('sha256').update(sourceIp).digest('hex')}:${window}`
  const takeTransportQuota = () => LoginAttemptModel.updateOne(
    { _id: transportKey, count: { $lt: 60 } },
    { $inc: { count: 1 } },
  )
  let transport = await takeTransportQuota()
  if (transport.modifiedCount !== 1) {
    try {
      await LoginAttemptModel.updateOne(
        { _id: transportKey },
        { $setOnInsert: { count: 0, expiresAt: bucketExpiresAt } },
        { upsert: true },
      )
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    }
    transport = await takeTransportQuota()
    if (transport.modifiedCount !== 1) return { error: 'RATE_LIMIT' as const }
  }
  const pairKey = `pair:${createHash('sha256').update(`${email.toLowerCase()}:${sourceIp}`).digest('hex')}:${window}`
  const pair = await LoginAttemptModel.findById(pairKey)
  if (pair?.count >= 5) return { error: 'RATE_LIMIT' as const }
  const admin = await AdminModel.findById('global')
  const hash = admin?.email === email.toLowerCase() ? admin.passwordHash : await dummyHash
  const validPassword = await argon2.verify(hash, password)
  if (!admin || admin.email !== email.toLowerCase() || !validPassword) {
    await LoginAttemptModel.findOneAndUpdate(
      { _id: pairKey },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: bucketExpiresAt } },
      { upsert: true },
    )
    return { error: 'INVALID_CREDENTIALS' as const }
  }
  await LoginAttemptModel.deleteOne({ _id: pairKey })
  const sid = randomUUID()
  const csrfToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_MS)
  const { key: jwtKey, issuer, audience } = jwtSettings()
  await SessionModel.create({ _id: sid, adminId: admin.id, csrfToken, expiresAt })
  const token = await new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer).setAudience(audience).setSubject(admin.id)
    .setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(jwtKey)
  return { admin: { id: admin.id, email: admin.email }, csrfToken, token }
}

export async function getAdminSession(token: string) {
  const { key, issuer, audience } = jwtSettings()
  let payload
  try {
    payload = (await jwtVerify(token, key, { issuer, audience, algorithms: ['HS256'] })).payload
  } catch { return null }
  if (typeof payload.sid !== 'string' || payload.sub !== 'global') return null
  await connectDatabase()
  const session = await SessionModel.findOne({ _id: payload.sid, adminId: payload.sub, expiresAt: { $gt: new Date() } })
  if (!session) return null
  const admin = await AdminModel.findById(payload.sub)
  if (!admin) return null
  return { sid: session.id as string, csrfToken: session.csrfToken as string, admin: { id: admin.id as string, email: admin.email as string } }
}

export async function revokeSession(sid: string) {
  await connectDatabase()
  await SessionModel.deleteOne({ _id: sid })
}

function presentOrganization(doc: any) {
  return {
    id: doc.id as string,
    name: doc.name as string,
    visualIdentity: doc.visualIdentity ?? {},
    settings: doc.settings ?? {},
    createdAt: doc.createdAt.toISOString() as string,
    updatedAt: doc.updatedAt.toISOString() as string,
  }
}

export async function listOrganizations() {
  await connectDatabase()
  const docs = await OrganizationModel.find({}).sort({ createdAt: -1, _id: -1 })
  return docs.map(presentOrganization)
}

export async function createOrganization(input: OrganizationInput) {
  const data = organizationInput.parse(input)
  await connectDatabase()
  return presentOrganization(await OrganizationModel.create(data))
}

export async function getOrganization(id: string) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null
  await connectDatabase()
  const doc = await OrganizationModel.findById(id)
  return doc ? presentOrganization(doc) : null
}

export async function updateOrganization(id: string, input: Partial<OrganizationInput>) {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null
  const data = organizationPatch.parse(input)
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'visualIdentity' || key === 'settings') {
      for (const [field, fieldValue] of Object.entries(value ?? {})) updates[`${key}.${field}`] = fieldValue
    } else updates[key] = value
  }
  await connectDatabase()
  const doc = await OrganizationModel.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
  return doc ? presentOrganization(doc) : null
}

const objectId = /^[0-9a-fA-F]{24}$/
const validId = (id: string) => objectId.test(id)
const escapeRegex = (value: string) => value.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')

function presentEvent(doc: any) {
  return {
    id: doc.id as string, organizationId: String(doc.organizationId), name: doc.name as string,
    description: doc.description as string | undefined, location: doc.location as string, address: doc.address as string,
    status: doc.status as string, publishedTemplateVersion: doc.publishedTemplateVersion as number,
    amendmentVersion: doc.amendmentVersion as number, revision: doc.revision as number,
    changeVersion: doc.changeVersion as number,
    ...(doc.cancelledAt ? { cancelledAt: doc.cancelledAt.toISOString() as string } : {}),
    startsAt: doc.startsAt.toISOString() as string,
    endsAt: doc.endsAt.toISOString() as string, rsvpDeadline: doc.rsvpDeadline.toISOString() as string,
    timeZone: doc.timeZone as string, companionLimit: doc.companionLimit as number,
    companionNamesRequired: doc.companionNamesRequired as boolean,
    createdAt: doc.createdAt.toISOString() as string, updatedAt: doc.updatedAt.toISOString() as string,
  }
}

export function hasGuestWhatsAppConsent(doc: any) {
  const authorization = doc.whatsappAuthorization
  return doc.whatsappConsent === true && !doc.whatsappOptedOutAt &&
    typeof authorization?.source === 'string' && authorization.source.trim().length >= 5 &&
    typeof authorization?.confirmedBy === 'string' && authorization.confirmedBy.length > 0 &&
    authorization.confirmedAt instanceof Date && !Number.isNaN(authorization.confirmedAt.getTime())
}

function presentGuest(doc: any) {
  return {
    id: doc.id as string, organizationId: String(doc.organizationId), name: doc.name as string,
    phone: doc.phone as string, email: doc.email as string | undefined,
    tags: doc.tags as string[], notes: doc.notes as string,
    whatsappConsent: hasGuestWhatsAppConsent(doc),
    ...(doc.whatsappAuthorization?.source ? { authorizationSource: doc.whatsappAuthorization.source as string } : {}),
    whatsappOptedOutAt: doc.whatsappOptedOutAt?.toISOString() as string | undefined,
    createdAt: doc.createdAt.toISOString() as string, updatedAt: doc.updatedAt.toISOString() as string,
  }
}

async function organizationExists(id: string) {
  if (!validId(id)) return false
  await connectDatabase()
  return Boolean(await OrganizationModel.exists({ _id: id }))
}

function eventDates(data: EventInput) {
  return { ...data, startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), rsvpDeadline: new Date(data.rsvpDeadline) }
}

export async function createEvent(organizationId: string, input: EventInput) {
  if (!await organizationExists(organizationId)) return null
  const data = eventInput.parse(input)
  return presentEvent(await EventModel.create({ ...eventDates(data), organizationId, status: 'draft' }))
}

export async function listEvents(organizationId: string, query: ListQuery) {
  if (!await organizationExists(organizationId)) return null
  const { page, limit, q } = listQuery.parse(query)
  const filter = { organizationId, ...(q ? { name: { $regex: escapeRegex(q), $options: 'i' } } : {}) }
  const [docs, total] = await Promise.all([
    EventModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    EventModel.countDocuments(filter),
  ])
  return { items: docs.map(presentEvent), page, limit, total }
}

export async function getEvent(organizationId: string, eventId: string) {
  if (!validId(organizationId) || !validId(eventId)) return null
  await connectDatabase()
  const doc = await EventModel.findOne({ _id: eventId, organizationId })
  return doc ? presentEvent(doc) : null
}

export async function updateEvent(organizationId: string, eventId: string, input: Partial<EventInput>) {
  if (!validId(organizationId) || !validId(eventId)) return null
  const patch = eventPatch.parse(input)
  await connectDatabase()
  const doc = await EventModel.findOne({ _id: eventId, organizationId, status: 'draft' })
  if (!doc) return null
  const merged = eventInput.parse({
    name: patch.name ?? doc.name,
    description: patch.description ?? doc.description,
    location: patch.location ?? doc.location,
    address: patch.address ?? doc.address,
    startsAt: patch.startsAt ?? doc.startsAt.toISOString(),
    endsAt: patch.endsAt ?? doc.endsAt.toISOString(),
    rsvpDeadline: patch.rsvpDeadline ?? doc.rsvpDeadline.toISOString(),
    timeZone: patch.timeZone ?? doc.timeZone,
    companionLimit: patch.companionLimit ?? doc.companionLimit,
    companionNamesRequired: patch.companionNamesRequired ?? doc.companionNamesRequired,
  })
  Object.assign(doc, eventDates(merged))
  doc.revision = (doc.revision ?? 0) + 1
  return presentEvent(await doc.save())
}

export async function cancelEvent(organizationId: string, eventId: string, input: unknown) {
  const parsed = eventCancelInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  if (!validId(organizationId) || !validId(eventId)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const event = await EventModel.findOne({ _id: eventId, organizationId })
  if (!event) return { error: 'NOT_FOUND' as const }
  if (event.status === 'cancelled' && event.revision === parsed.data.expectedRevision + 1) {
    await InvitationModel.updateMany({ eventId, organizationId, revokedAt: { $exists: false } },
      { $set: { revokedAt: event.cancelledAt } })
    return { event: presentEvent(event) }
  }
  if (event.status !== 'published' || event.revision !== parsed.data.expectedRevision) return { error: 'CONFLICT' as const }
  const cancelledAt = new Date()
  const updated = await EventModel.findOneAndUpdate({ _id: eventId, organizationId,
    status: 'published', revision: parsed.data.expectedRevision },
  { $set: { status: 'cancelled', cancelledAt }, $inc: { revision: 1, changeVersion: 1 } }, { new: true })
  if (!updated) return { error: 'CONFLICT' as const }
  await InvitationModel.updateMany({ eventId, organizationId, revokedAt: { $exists: false } },
    { $set: { revokedAt: cancelledAt } })
  return { event: presentEvent(updated) }
}

export async function revisePublishedEvent(organizationId: string, eventId: string, input: unknown) {
  const parsed = eventRevisionInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  if (!validId(organizationId) || !validId(eventId)) return { error: 'NOT_FOUND' as const }
  const db = await connectDatabase()
  await TemplateVersionModel.init()
  const session = await db.startSession()
  const conflict = new Error('EVENT_REVISION_CONFLICT')
  try {
    const result = await session.withTransaction(async () => {
      const event = await EventModel.findOne({ _id: eventId, organizationId }).session(session)
      if (!event) return { error: 'NOT_FOUND' as const }
      if (event.status !== 'published' || event.revision !== parsed.data.expectedRevision ||
        !event.publishedTemplateVersion) return { error: 'CONFLICT' as const }
      const merged = eventInput.safeParse({
        name: parsed.data.changes.name ?? event.name,
        description: parsed.data.changes.description ?? event.description,
        location: parsed.data.changes.location ?? event.location,
        address: parsed.data.changes.address ?? event.address,
        startsAt: parsed.data.changes.startsAt ?? event.startsAt.toISOString(),
        endsAt: parsed.data.changes.endsAt ?? event.endsAt.toISOString(),
        rsvpDeadline: parsed.data.changes.rsvpDeadline ?? event.rsvpDeadline.toISOString(),
        timeZone: parsed.data.changes.timeZone ?? event.timeZone,
        companionLimit: event.companionLimit, companionNamesRequired: event.companionNamesRequired,
      })
      if (!merged.success) return { error: 'INVALID' as const }
      const previous = await TemplateVersionModel.findOne({ organizationId, eventId,
        version: event.publishedTemplateVersion }).session(session)
      if (!previous) return { error: 'CONFLICT' as const }
      const nextVersion = event.publishedTemplateVersion + 1
      const snapshot = { name: merged.data.name, location: merged.data.location, address: merged.data.address,
        startsAt: new Date(merged.data.startsAt).toISOString(), endsAt: new Date(merged.data.endsAt).toISOString(),
        rsvpDeadline: new Date(merged.data.rsvpDeadline).toISOString(), timeZone: merged.data.timeZone,
        companionLimit: event.companionLimit, companionNamesRequired: event.companionNamesRequired }
      const versionFilter = { _id: eventId, organizationId, status: 'published',
        revision: parsed.data.expectedRevision, publishedTemplateVersion: event.publishedTemplateVersion,
        updatedAt: event.updatedAt }
      await TemplateVersionModel.create([{ organizationId, eventId, version: nextVersion,
        sourceDraftRevision: event.templateDraftRevision, sourceEventUpdatedAt: event.updatedAt,
        template: structuredClone(previous.template), event: snapshot }], { session })
      const updated = await EventModel.findOneAndUpdate(versionFilter,
        { $set: { ...eventDates(merged.data), publishedTemplateVersion: nextVersion, amendmentVersion: nextVersion },
          $inc: { revision: 1, changeVersion: 1 } }, { new: true, runValidators: true, session })
      if (!updated) throw conflict
      await InvitationModel.updateMany({ eventId, organizationId, revokedAt: { $exists: false } },
        { $set: { rsvpDeadline: new Date(merged.data.rsvpDeadline) },
          $min: { expiresAt: new Date(merged.data.endsAt) } }, { session })
      return { event: presentEvent(updated) }
    })
    return result ?? { error: 'CONFLICT' as const }
  } catch (error: unknown) {
    if (error === conflict || (error && typeof error === 'object' && 'code' in error && error.code === 11000)) {
      return { error: 'CONFLICT' as const }
    }
    throw error
  } finally { await session.endSession() }
}

export async function getTemplateDraft(organizationId: string, eventId: string) {
  if (!validId(organizationId) || !validId(eventId)) return null
  await connectDatabase()
  const event = await EventModel.findOne({ _id: eventId, organizationId }).select('templateDraft')
  return event ? (event.templateDraft ?? defaultTemplate) as TemplateInput : null
}

export async function saveTemplateDraft(organizationId: string, eventId: string, input: TemplateInput) {
  if (!validId(organizationId) || !validId(eventId)) return null
  const template = templateInput.parse(input)
  await connectDatabase()
  const event = await EventModel.findOneAndUpdate(
    { _id: eventId, organizationId },
    { $set: { templateDraft: template }, $inc: { templateDraftRevision: 1 } },
    { new: true, runValidators: true },
  )
  return event ? template : null
}

function presentTemplateVersion(doc: any) {
  return {
    version: doc.version as number,
    template: doc.template as TemplateInput,
    event: doc.event as Record<string, unknown>,
    createdAt: doc.createdAt.toISOString() as string,
  }
}

export async function getTemplateVersion(organizationId: string, eventId: string, version: number) {
  if (!validId(organizationId) || !validId(eventId) || !Number.isSafeInteger(version) || version < 1) return null
  await connectDatabase()
  const event = await EventModel.findOne({ _id: eventId, organizationId, publishedTemplateVersion: { $gte: version } }).select('_id')
  if (!event) return null
  const doc = await TemplateVersionModel.findOne({ organizationId, eventId, version })
  return doc ? presentTemplateVersion(doc) : null
}

export async function publishTemplate(
  organizationId: string, eventId: string, assetBelongsToOrganization: (assetId: string, organizationId: string) => Promise<boolean>,
): Promise<
  { publication: ReturnType<typeof presentTemplateVersion> } | { error: 'NOT_FOUND' | 'NO_DRAFT' | 'INVALID_ASSET' | 'CONFLICT' }
> {
  if (!validId(organizationId) || !validId(eventId)) return { error: 'NOT_FOUND' }
  await connectDatabase()
  const event = await EventModel.findOne({ _id: eventId, organizationId })
  if (!event) return { error: 'NOT_FOUND' }
  if (event.status === 'cancelled') return { error: 'CONFLICT' }
  if (!event.templateDraft) return { error: 'NO_DRAFT' }
  const parsed = templateInput.safeParse(event.templateDraft)
  if (!parsed.success) return { error: 'NO_DRAFT' }
  if (parsed.data.imageAssetId && !await assetBelongsToOrganization(parsed.data.imageAssetId, organizationId)) return { error: 'INVALID_ASSET' }
  const version = (event.publishedTemplateVersion ?? 0) + 1
  const versionFilter = {
    _id: eventId, organizationId, status: { $ne: 'cancelled' },
    templateDraftRevision: event.templateDraftRevision, updatedAt: event.updatedAt,
    ...(version === 1 ? { $or: [{ publishedTemplateVersion: 0 }, { publishedTemplateVersion: { $exists: false } }] } : { publishedTemplateVersion: version - 1 }),
  }
  await TemplateVersionModel.init()
  let doc
  try {
    doc = await TemplateVersionModel.create({
      organizationId, eventId, version, sourceDraftRevision: event.templateDraftRevision,
      sourceEventUpdatedAt: event.updatedAt, template: structuredClone(parsed.data),
      event: {
        name: event.name, location: event.location, address: event.address,
        startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(),
        rsvpDeadline: event.rsvpDeadline.toISOString(), timeZone: event.timeZone,
        companionLimit: event.companionLimit, companionNamesRequired: event.companionNamesRequired,
      },
    })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      const existing = await TemplateVersionModel.findOne({ eventId, version })
      if (!existing) return { error: 'CONFLICT' }
      if (existing.sourceDraftRevision === event.templateDraftRevision &&
        existing.sourceEventUpdatedAt?.getTime() === event.updatedAt.getTime()) {
        const adopted = await EventModel.findOneAndUpdate(versionFilter, { $set: { status: 'published', publishedTemplateVersion: version } })
        if (adopted) return { publication: presentTemplateVersion(existing) }
      } else {
        const current = await EventModel.findOne({ _id: eventId, organizationId }).select('publishedTemplateVersion')
        if (current && (current.publishedTemplateVersion ?? 0) < version) await TemplateVersionModel.deleteOne({ _id: existing.id })
      }
      return { error: 'CONFLICT' }
    }
    throw error
  }
  const updated = await EventModel.findOneAndUpdate(
    versionFilter,
    { $set: { status: 'published', publishedTemplateVersion: version } },
  )
  if (!updated) {
    const current = await EventModel.findOne({ _id: eventId, organizationId }).select('publishedTemplateVersion')
    if (current && (current.publishedTemplateVersion ?? 0) < version) await TemplateVersionModel.deleteOne({ _id: doc.id })
    return { error: 'CONFLICT' }
  }
  return { publication: presentTemplateVersion(doc) }
}

function guestAuthorization(source: string | undefined, adminId: string) {
  if (!source || !adminId) throw new SyntaxError('Origem da autorização e administrador são obrigatórios.')
  return { source, confirmedBy: adminId, confirmedAt: new Date() }
}

export async function createGuest(organizationId: string, input: GuestInput, adminId: string) {
  if (!await organizationExists(organizationId)) return null
  const { authorizationSource, ...data } = guestInput.parse(input)
  return presentGuest(await GuestModel.create({ ...data, organizationId,
    ...(data.whatsappConsent ? { whatsappAuthorization: guestAuthorization(authorizationSource, adminId) } : {}) }))
}

export async function listGuests(organizationId: string, query: GuestListQuery) {
  if (!await organizationExists(organizationId)) return null
  const { page, limit, q, tag } = guestListQuery.parse(query)
  const search = q ? { $or: [
    { name: { $regex: escapeRegex(q), $options: 'i' } },
    { phone: { $regex: escapeRegex(q), $options: 'i' } },
    { email: { $regex: escapeRegex(q), $options: 'i' } },
  ] } : {}
  const filter = { organizationId, ...search, ...(tag ? { tags: tag } : {}) }
  const [docs, total] = await Promise.all([
    GuestModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
    GuestModel.countDocuments(filter),
  ])
  return { items: docs.map(presentGuest), page, limit, total }
}

export async function getGuest(organizationId: string, guestId: string) {
  if (!validId(organizationId) || !validId(guestId)) return null
  await connectDatabase()
  const doc = await GuestModel.findOne({ _id: guestId, organizationId })
  return doc ? presentGuest(doc) : null
}

export async function updateGuest(organizationId: string, guestId: string, input: Partial<GuestInput>, adminId: string) {
  if (!validId(organizationId) || !validId(guestId)) return null
  const { authorizationSource, ...patch } = guestPatch.parse(input)
  await connectDatabase()
  const existing = patch.whatsappConsent === true
    ? await GuestModel.findOne({ _id: guestId, organizationId }) : null
  if (patch.whatsappConsent === true && !existing) return null
  const preserveAuthorization = existing && hasGuestWhatsAppConsent(existing) &&
    existing.whatsappAuthorization.source === authorizationSource &&
    (patch.phone === undefined || patch.phone === existing.phone)
  const doc = await GuestModel.findOneAndUpdate(
    { _id: guestId, organizationId, ...(existing ? { updatedAt: existing.updatedAt } : {}) },
    { $set: { ...patch,
      ...(patch.whatsappConsent && !preserveAuthorization
        ? { whatsappAuthorization: guestAuthorization(authorizationSource, adminId) } : {}) } },
    { new: true, runValidators: true },
  )
  if (!doc && existing) throw new Error('GUEST_CONFLICT')
  return doc ? presentGuest(doc) : null
}

type CsvRow = { line: number, fields: string[] }
function parseCsv(csv: string): CsvRow[] {
  const rows: CsvRow[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index]
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { field += '"'; index++ }
      else if (char === '"') quoted = false
      else { field += char; if (char === '\n') line++ }
    } else if (char === '"' && field === '') quoted = true
    else if (char === ',') { fields.push(field); field = '' }
    else if (char === '\n') {
      fields.push(field.replace(/\r$/, ''))
      if (fields.some(value => value !== '')) rows.push({ line: rowLine, fields })
      fields = []
      field = ''
      line++
      rowLine = line
    } else field += char
  }
  if (quoted) throw new SyntaxError('CSV com aspas não fechadas')
  fields.push(field.replace(/\r$/, ''))
  if (fields.some(value => value !== '')) rows.push({ line: rowLine, fields })
  if (rows.length < 2 || rows.length > 201) throw new SyntaxError('CSV deve ter de 1 a 200 contatos')
  return rows
}

export async function previewGuestsCsv(organizationId: string, input: { csv: string }) {
  if (!await organizationExists(organizationId)) return null
  const { csv } = csvPreviewInput.parse(input)
  const records = parseCsv(csv)
  const headers = records.shift()!.fields.map(value => value.trim().toLowerCase())
  if (headers[0] !== 'name' || headers[1] !== 'phone' || headers.length > 5 ||
    headers.some((header, index) => index >= 2 && !['email', 'tags', 'notes'].includes(header)) ||
    new Set(headers).size !== headers.length) throw new SyntaxError('Cabeçalho CSV inválido')
  const raw = records.map(({ line, fields }) => {
    const value = Object.fromEntries(headers.map((header, index) => [header, fields[index]?.trim() ?? '']))
    const parsed = guestInput.safeParse({
      name: value.name, phone: value.phone,
      ...(value.email ? { email: value.email } : {}),
      tags: value.tags ? value.tags.split('|').map(tag => tag.trim()) : [],
      notes: value.notes ?? '',
    })
    return { line, guest: parsed.success ? parsed.data : undefined,
      errors: fields.length > headers.length ? ['Colunas excedentes'] :
        parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
      duplicates: [] as string[] }
  })
  const phones = raw.flatMap(row => row.guest ? [row.guest.phone] : [])
  const existing = await GuestModel.find({ organizationId, phone: { $in: phones } }).select('phone')
  const existingPhones = new Set(existing.map(doc => doc.phone as string))
  const seen = new Map<string, number>()
  for (const row of raw) {
    const phone = row.guest?.phone
    if (!phone) continue
    if (existingPhones.has(phone)) row.duplicates.push('Telefone já cadastrado')
    if (seen.has(phone)) row.duplicates.push(`Telefone também na linha ${seen.get(phone)}`)
    else seen.set(phone, row.line)
  }
  return { rows: raw }
}

export async function importGuestsCsv(organizationId: string, input: { csv: string, acceptedRows: number[], batchId: string }) {
  const data = csvImportInput.parse(input)
  const preview = await previewGuestsCsv(organizationId, { csv: data.csv })
  if (!preview) return null
  const unique = new Set(data.acceptedRows)
  if (unique.size !== data.acceptedRows.length) throw new SyntaxError('Linhas repetidas')
  const selected = data.acceptedRows.map(line => preview.rows.find(row => row.line === line))
  if (selected.some(row => !row || row.errors.length)) throw new SyntaxError('Linha inválida')
  await GuestModel.init()
  const docs = []
  for (const row of selected) {
    const filter = { organizationId, importBatchId: data.batchId, importLine: row!.line }
    let doc
    try {
      doc = await GuestModel.findOneAndUpdate(filter, { $setOnInsert: row!.guest }, {
        upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true,
      })
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
      doc = await GuestModel.findOne(filter)
      if (!doc) throw error
    }
    docs.push(doc)
  }
  return { created: docs.map(presentGuest), errors: preview.rows.filter(row => row.errors.length).map(row => ({ line: row.line, errors: row.errors })) }
}

export async function previewGuestsFile(organizationId: string, input: { file: ContactFile }) {
  if (!await organizationExists(organizationId)) return null
  const rows = await parseContactFile(input.file)
  const existing = await GuestModel.find({ organizationId, phone: { $in: rows.flatMap(row => row.guest ? [row.guest.phone] : []) } }).select('phone')
  const phones = new Set(existing.map(doc => doc.phone))
  for (const row of rows) if (row.guest && phones.has(row.guest.phone)) row.duplicates.push('Telefone já cadastrado.')
  return { rows }
}

async function persistImportedPhone(organizationId: string, phone: string, insertion: Record<string, unknown>) {
  const key = createHash('sha256').update(`${organizationId}:${phone}`).digest('hex')
  for (let attempt = 0; attempt < 3; attempt++) {
    let reservation
    try {
      reservation = await GuestImportPhoneModel.findOneAndUpdate({ _id: key }, {
        $setOnInsert: { guestId: randomBytes(12).toString('hex') },
      }, { upsert: true, new: true })
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
      reservation = await GuestImportPhoneModel.findById(key)
    }
    if (!reservation) throw new Error('Reserva de importação indisponível')
    const filter = { _id: reservation.guestId, organizationId }
    let doc = await GuestModel.findOne(filter).select('+importSourceHash')
    if (!doc) {
      try {
        doc = await GuestModel.findOneAndUpdate(filter, { $setOnInsert: insertion }, {
          upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true,
        }).select('+importSourceHash')
      } catch (error: unknown) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
        doc = await GuestModel.findOne(filter).select('+importSourceHash')
        if (!doc) throw error
      }
    }
    if (!doc) throw new Error('Contato não persistido')
    if (doc.phone === phone) return doc
    // Editing a contact releases the old number without changing guest CRUD semantics.
    await GuestImportPhoneModel.deleteOne({ _id: key, guestId: reservation.guestId })
  }
  throw new SyntaxError('Telefone em edição simultânea. Repita a importação.')
}

export async function importGuestsFile(organizationId: string, input: GuestFileImportInput, adminId: string) {
  const data = guestFileImportInput.parse(input)
  organizationId = organizationId.toLowerCase()
  data.batchId = data.batchId.toLowerCase()
  if (data.whatsappConsent && !adminId) throw new SyntaxError('Administrador necessário para registrar autorização.')
  const preview = await previewGuestsFile(organizationId, data)
  if (!preview) return null
  if (new Set(data.acceptedRows).size !== data.acceptedRows.length) throw new SyntaxError('Linhas repetidas.')
  const selected = data.acceptedRows.map(line => preview.rows.find(row => row.line === line))
  if (selected.some(row => !row || row.errors.length || !row.guest)) throw new SyntaxError('Selecione apenas linhas válidas.')
  const sourceHash = createHash('sha256').update(JSON.stringify({
    file: data.file, rows: [...data.acceptedRows].sort((a, b) => a - b),
    whatsappConsent: data.whatsappConsent, authorizationSource: data.authorizationSource ?? '',
  })).digest('hex')
  await GuestModel.init()
  const batchKey = createHash('sha256').update(`${organizationId}:${data.batchId}`).digest('hex')
  let batch
  try {
    batch = await GuestImportBatchModel.findOneAndUpdate({ _id: batchKey }, { $setOnInsert: { sourceHash } }, { upsert: true, new: true })
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    batch = await GuestImportBatchModel.findById(batchKey)
  }
  if (batch?.sourceHash !== sourceHash) throw new SyntaxError('Lote já usado com outro arquivo, seleção ou autorização.')
  const previous = await GuestModel.find({ organizationId, importBatchId: data.batchId }).select('+importSourceHash')
  if (previous.some(doc => doc.importSourceHash !== sourceHash)) throw new SyntaxError('Lote já usado com outro arquivo, seleção ou autorização.')
  const existingDocs = await GuestModel.find({ organizationId, phone: { $in: selected.map(row => row!.guest!.phone) } })
  const existingByPhone = new Map(existingDocs.map(doc => [doc.phone as string, doc]))
  const created = [], reused = []
  for (const row of selected) {
    const retry = previous.find(doc => doc.importLine === row!.line)
    if (retry) { created.push(retry); continue }
    const guest = row!.guest!
    const existing = existingByPhone.get(guest.phone)
    if (existing) { reused.push(existing); continue }
    const doc = await persistImportedPhone(organizationId, guest.phone, {
      ...guest, organizationId, importBatchId: data.batchId, importLine: row!.line, importSourceHash: sourceHash,
      whatsappConsent: data.whatsappConsent,
      ...(data.whatsappConsent ? { whatsappAuthorization: {
        source: data.authorizationSource, confirmedBy: adminId, confirmedAt: new Date(),
      } } : {}),
    })
    existingByPhone.set(guest.phone, doc)
    if (doc.importBatchId === data.batchId && doc.importLine === row!.line && doc.importSourceHash === sourceHash) created.push(doc)
    else reused.push(doc)
  }
  return { created: created.map(presentGuest), reused: [...new Map(reused.map(doc => [doc.id, doc])).values()].map(presentGuest),
    errors: preview.rows.filter(row => row.errors.length).map(row => ({ line: row.line, errors: row.errors })) }
}

const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/

function inviteKey() {
  const encoded = process.env.INVITE_LINK_KEY || ''
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('INVITE_LINK_KEY inválida')
  return key
}

function protectInviteToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', inviteKey(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.')
}

function recoverInviteToken(value: string) {
  const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part || '', 'base64url'))
  if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16) throw new Error('Convite cifrado inválido')
  const decipher = createDecipheriv('aes-256-gcm', inviteKey(), iv)
  decipher.setAuthTag(tag)
  const token = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  if (!inviteTokenPattern.test(token)) throw new Error('Convite cifrado inválido')
  return token
}

function inviteLink(token: string) {
  const origin = process.env.INVITE_ORIGIN
  if (!origin) throw new Error('INVITE_ORIGIN ausente')
  return new URL(`/i/${token}`, origin).toString()
}

function presentInvitation(doc: any, guestName?: string) {
  return {
    id: doc.id as string, guestId: String(doc.guestId), guestName,
    templateVersion: doc.templateVersion as number, expiresAt: doc.expiresAt.toISOString() as string,
    ...(doc.revokedAt ? { revokedAt: doc.revokedAt.toISOString() as string } : {}),
    responseStatus: doc.responseStatus as string, companions: doc.companions as string[],
    responseVersion: doc.responseVersion as number,
    ...(doc.respondedAt ? { respondedAt: doc.respondedAt.toISOString() as string } : {}),
    createdAt: doc.createdAt.toISOString() as string,
  }
}

function presentResponse(doc: any) {
  return {
    status: doc.responseStatus as 'pending' | 'accepted' | 'declined',
    companions: doc.companions as string[], version: doc.responseVersion as number,
    ...(doc.respondedAt ? { respondedAt: doc.respondedAt.toISOString() as string } : {}),
    peopleCount: doc.responseStatus === 'accepted' ? 1 + doc.companions.length : 0,
  }
}

export async function createInvitation(organizationId: string, eventId: string, input: InvitationCreateInput) {
  if (!validId(organizationId) || !validId(eventId)) return { error: 'NOT_FOUND' as const }
  const data = invitationCreateInput.parse(input)
  await connectDatabase()
  const [event, guest] = await Promise.all([
    EventModel.findOne({ _id: eventId, organizationId }), GuestModel.findOne({ _id: data.guestId, organizationId }),
  ])
  if (!event || !guest) return { error: 'NOT_FOUND' as const }
  if (event.status !== 'published' || !event.publishedTemplateVersion) return { error: 'NOT_PUBLISHED' as const }
  const now = new Date()
  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : event.endsAt
  if (expiresAt <= now || expiresAt > event.endsAt) return { error: 'EXPIRY' as const }
  await InvitationModel.init()
  const existing = await InvitationModel.findOne({ eventId, guestId: data.guestId })
  if (existing) return existing.revokedAt ? { error: 'REVOKED' as const } : {
    invitation: presentInvitation(existing, guest.name), link: inviteLink(recoverInviteToken(existing.secretCiphertext)), created: false,
  }
  const token = randomBytes(32).toString('base64url')
  let doc
  try {
    doc = await InvitationModel.create({
      organizationId, eventId, guestId: data.guestId, templateVersion: event.publishedTemplateVersion,
      secretHash: createHash('sha256').update(token).digest('hex'), secretCiphertext: protectInviteToken(token),
      expiresAt, rsvpDeadline: event.rsvpDeadline, companionLimit: event.companionLimit,
      companionNamesRequired: event.companionNamesRequired,
    })
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    const winner = await InvitationModel.findOne({ eventId, guestId: data.guestId })
    if (!winner) throw error
    return winner.revokedAt ? { error: 'REVOKED' as const } : {
      invitation: presentInvitation(winner, guest.name), link: inviteLink(recoverInviteToken(winner.secretCiphertext)), created: false,
    }
  }
  return { invitation: presentInvitation(doc, guest.name), link: inviteLink(token), created: true }
}

export async function listInvitations(organizationId: string, eventId: string) {
  if (!validId(organizationId) || !validId(eventId)) return null
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return null
  const docs = await InvitationModel.find({ organizationId, eventId }).sort({ createdAt: -1, _id: -1 })
  const guests = await GuestModel.find({ _id: { $in: docs.map(doc => doc.guestId) }, organizationId }).select('name tags')
  const names = new Map(guests.map(guest => [guest.id, guest.name as string]))
  const reportableGuestIds = new Set(guests
    .filter(guest => !((guest.tags as string[] | undefined) ?? []).includes('teste-zingara'))
    .map(guest => guest.id))
  const totals = { pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 }
  for (const doc of docs) {
    if (!reportableGuestIds.has(String(doc.guestId))) continue
    if (doc.revokedAt) totals.revoked++
    else {
      totals[doc.responseStatus as 'pending' | 'accepted' | 'declined']++
      if (doc.responseStatus === 'accepted') totals.peopleConfirmed += 1 + doc.companions.length
    }
  }
  return { items: docs.map(doc => presentInvitation(doc, names.get(String(doc.guestId)))), totals }
}

export { getEventReport } from './event-report.ts'

async function scopedInvitation(organizationId: string, eventId: string, invitationId: string) {
  if (![organizationId, eventId, invitationId].every(validId)) return null
  await connectDatabase()
  return InvitationModel.findOne({ _id: invitationId, organizationId, eventId })
}

export async function getInvitationLink(organizationId: string, eventId: string, invitationId: string) {
  const doc = await scopedInvitation(organizationId, eventId, invitationId)
  if (!doc) return null
  if (doc.revokedAt) return { error: 'REVOKED' as const }
  return { link: inviteLink(recoverInviteToken(doc.secretCiphertext)) }
}

export async function rotateInvitation(organizationId: string, eventId: string, invitationId: string) {
  const doc = await scopedInvitation(organizationId, eventId, invitationId)
  if (!doc) return null
  if (doc.revokedAt) return { error: 'REVOKED' as const }
  if (doc.expiresAt <= new Date()) return { error: 'EXPIRED' as const }
  const token = randomBytes(32).toString('base64url')
  const updated = await InvitationModel.findOneAndUpdate(
    { _id: doc.id, organizationId, eventId, secretHash: doc.secretHash,
      revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { secretHash: createHash('sha256').update(token).digest('hex'), secretCiphertext: protectInviteToken(token) } },
    { new: true },
  )
  if (!updated) return { error: 'CONFLICT' as const }
  return { invitation: presentInvitation(updated), link: inviteLink(token) }
}

export async function revokeInvitation(organizationId: string, eventId: string, invitationId: string) {
  const doc = await scopedInvitation(organizationId, eventId, invitationId)
  if (!doc) return null
  if (doc.revokedAt) return { invitation: presentInvitation(doc) }
  const updated = await InvitationModel.findOneAndUpdate(
    { _id: doc.id, organizationId, eventId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }, { new: true },
  )
  return { invitation: presentInvitation(updated ?? await InvitationModel.findById(doc.id) ?? doc) }
}

async function findActiveInvitation(token: string) {
  if (!inviteTokenPattern.test(token)) return null
  await connectDatabase()
  const invitation = await InvitationModel.findOne({ secretHash: createHash('sha256').update(token).digest('hex'),
    revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
  if (!invitation) return null
  const event = await EventModel.findOne({ _id: invitation.eventId,
    organizationId: invitation.organizationId, status: 'published' })
  if (!event) return null
  const expiresAt = invitation.expiresAt.getTime() <= event.endsAt.getTime() ? invitation.expiresAt : event.endsAt
  if (expiresAt <= new Date()) return null
  return { invitation, event, expiresAt }
}

export async function getPublicInvitation(token: string) {
  const active = await findActiveInvitation(token)
  if (!active) return null
  const { invitation: doc, event, expiresAt } = active
  const guest = await GuestModel.findById(doc.guestId).select('name')
  const version = await TemplateVersionModel.findOne({ eventId: doc.eventId,
    organizationId: doc.organizationId, version: event.amendmentVersion || doc.templateVersion })
  if (!guest || !version) return null
  return {
    guest: { name: guest.name as string },
    event: { name: version.event.name as string, location: version.event.location as string,
      address: version.event.address as string, startsAt: version.event.startsAt as string,
      timeZone: version.event.timeZone as string },
    template: Object.fromEntries(Object.entries(version.template as TemplateInput).filter(([key]) => key !== 'message')) as TemplateInput,
    response: presentResponse(doc), companionLimit: doc.companionLimit as number,
    companionNamesRequired: doc.companionNamesRequired as boolean,
    rsvpDeadline: event.rsvpDeadline.toISOString() as string, expiresAt: expiresAt.toISOString() as string,
  }
}

export async function submitRsvp(token: string, input: RsvpInput) {
  const data = rsvpInput.parse(input)
  const active = await findActiveInvitation(token)
  if (!active) return { error: 'NOT_FOUND' as const }
  const { invitation: doc, event } = active
  if (event.rsvpDeadline <= new Date()) return { error: 'DEADLINE' as const }
  if (data.companions.length > doc.companionLimit || (doc.companionNamesRequired && data.companions.some(name => !name))) {
    return { error: 'INVALID_COMPANIONS' as const }
  }
  const same = doc.responseStatus === data.status && JSON.stringify(doc.companions) === JSON.stringify(data.companions)
  if (same) return { response: presentResponse(doc) }
  if (doc.responseVersion !== data.expectedVersion) return { error: 'CONFLICT' as const }
  const now = new Date()
  const updated = await InvitationModel.findOneAndUpdate(
    { _id: doc.id, secretHash: doc.secretHash, responseVersion: data.expectedVersion,
      revokedAt: { $exists: false }, expiresAt: { $eq: doc.expiresAt, $gt: now }, rsvpDeadline: doc.rsvpDeadline },
    { $set: { responseStatus: data.status, companions: data.companions, respondedAt: now },
      $inc: { responseVersion: 1 }, $push: { history: { status: data.status, companions: data.companions, at: now, version: data.expectedVersion + 1 } } },
    { new: true },
  )
  if (updated) return { response: presentResponse(updated) }
  const current = await findActiveInvitation(token)
  if (!current) return { error: 'NOT_FOUND' as const }
  if (current.event.rsvpDeadline <= new Date()) return { error: 'DEADLINE' as const }
  if (current.invitation.responseStatus === data.status
    && JSON.stringify(current.invitation.companions) === JSON.stringify(data.companions)) {
    return { response: presentResponse(current.invitation) }
  }
  return { error: 'CONFLICT' as const }
}

function evolutionKey(purpose: 'encryption' | 'hash') {
  const encoded = process.env.EVOLUTION_CREDENTIAL_KEY || ''
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('EVOLUTION_CREDENTIAL_KEY inválida')
  return createHmac('sha256', key).update(`evolution:${purpose}:v1`).digest()
}

function encryptEvolutionSecret(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', evolutionKey('encryption'), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.')
}

function decryptEvolutionSecret(value: string) {
  const parts = value.split('.').map(part => Buffer.from(part, 'base64url'))
  if (parts.length !== 3 || parts[0]?.length !== 12 || parts[1]?.length !== 16) throw new Error('Credencial cifrada inválida')
  const decipher = createDecipheriv('aes-256-gcm', evolutionKey('encryption'), parts[0])
  decipher.setAuthTag(parts[1])
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString('utf8')
}

function hashEvolutionSecret(value: string) {
  return createHmac('sha256', evolutionKey('hash')).update(value).digest('hex')
}

async function evolutionBaseUrl() {
  await connectDatabase()
  if (process.env.EVOLUTION_BASE_URL) {
    const baseUrl = validateEvolutionInstallationOrigin(process.env.EVOLUTION_BASE_URL, process.env.EVOLUTION_BASE_URL)
    await assertEvolutionInstallationCompatible(baseUrl)
    return baseUrl
  }
  const installation = await EvolutionInstallationModel.findById('global').select('origin installationId')
  if (installation) return trustedEvolutionInstallation(installation.origin as string, installation.installationId as string).origin
  return process.env.EVOLUTION_MODE === 'real' ? '' : 'https://evolution.invalid'
}

async function currentEvolutionInstallationId() {
  try { return createHash('sha256').update(new URL(await evolutionBaseUrl()).origin).digest('hex') }
  catch { return '' }
}

function evolutionControlMode(): 'fake' | 'real' {
  return process.env.EVOLUTION_CONTROL_REAL_ENABLED === '1' || process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake'
}

function trustedEvolutionInstallation(origin: string, installationId: string) {
  const trustedOrigin = validateEvolutionInstallationOrigin(origin, process.env.EVOLUTION_BASE_URL || '')
  const expectedId = createHash('sha256').update(trustedOrigin).digest('hex')
  if (installationId !== expectedId) throw new Error('Instalação Evolution inválida')
  return { origin: trustedOrigin, installationId: expectedId }
}

function evolutionEnvironmentAdminConfig() {
  if (!process.env.EVOLUTION_BASE_URL || !process.env.EVOLUTION_API_KEY) return null
  return { baseUrl: validateEvolutionInstallationOrigin(process.env.EVOLUTION_BASE_URL, process.env.EVOLUTION_BASE_URL),
    adminApiKey: process.env.EVOLUTION_API_KEY }
}

async function assertEvolutionInstallationCompatible(baseUrl: string) {
  const installationId = createHash('sha256').update(new URL(baseUrl).origin).digest('hex')
  if (await EvolutionConnectionModel.exists({ installationId: { $ne: installationId }, archivedAt: { $exists: false } })) {
    throw new Error('Instalação Evolution divergente')
  }
}

async function hasConfiguredEvolutionInstallation() {
  if (process.env.EVOLUTION_BASE_URL && process.env.EVOLUTION_API_KEY) return true
  return Boolean(await EvolutionInstallationModel.exists({ _id: 'global' }))
}

async function evolutionAdminConfig() {
  await connectDatabase()
  const environment = evolutionEnvironmentAdminConfig()
  if (environment) {
    await assertEvolutionInstallationCompatible(environment.baseUrl)
    return environment
  }
  const installation = await EvolutionInstallationModel.findById('global').select('+apiKeyCiphertext')
  if (installation) {
    const trusted = trustedEvolutionInstallation(installation.origin as string, installation.installationId as string)
    return { baseUrl: trusted.origin, adminApiKey: decryptEvolutionSecret(installation.apiKeyCiphertext as string) }
  }
  return null
}

export async function readEvolutionInstallation(
  deps: { createClient?: typeof createEvolutionInstallationClient } = {},
) {
  await connectDatabase()
  let environment: ReturnType<typeof evolutionEnvironmentAdminConfig>
  try { environment = evolutionEnvironmentAdminConfig() }
  catch { throw new Error('Instalação Evolution indisponível') }
  if (environment) {
    try {
      await assertEvolutionInstallationCompatible(environment.baseUrl)
      await (deps.createClient ?? createEvolutionInstallationClient)({ ...environment, mode: 'real' }).verify()
      return { baseUrl: environment.baseUrl, verifiedAt: new Date().toISOString(),
        controlEnabled: evolutionControlMode() === 'real' }
    } catch { throw new Error('Instalação Evolution indisponível') }
  }
  const installation = await EvolutionInstallationModel.findById('global').select('+apiKeyCiphertext')
  if (installation) {
    try {
      const trusted = trustedEvolutionInstallation(installation.origin as string, installation.installationId as string)
      await (deps.createClient ?? createEvolutionInstallationClient)({ baseUrl: trusted.origin,
        adminApiKey: decryptEvolutionSecret(installation.apiKeyCiphertext as string), mode: 'real' }).verify()
      return { baseUrl: trusted.origin, verifiedAt: new Date().toISOString(),
        controlEnabled: evolutionControlMode() === 'real' }
    } catch { throw new Error('Instalação Evolution indisponível') }
  }
  return null
}

export async function saveEvolutionInstallation(input: EvolutionInstallationInput,
  deps: { createClient?: typeof createEvolutionInstallationClient } = {}) {
  const parsed = evolutionInstallationInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  let origin: string
  try { origin = validateEvolutionInstallationOrigin(parsed.data.baseUrl, process.env.EVOLUTION_BASE_URL || '') }
  catch { return { error: 'INVALID' as const } }
  const installationId = createHash('sha256').update(origin).digest('hex')
  await connectDatabase()
  if (await EvolutionConnectionModel.exists({ installationId: { $ne: installationId }, archivedAt: { $exists: false } })) {
    return { error: 'CONFLICT' as const }
  }
  try {
    const client = (deps.createClient ?? createEvolutionInstallationClient)({
      baseUrl: origin, adminApiKey: parsed.data.adminApiKey, mode: 'real' })
    await client.verify()
    await client.listInstances()
  } catch { return { error: 'UNAVAILABLE' as const } }
  const verifiedAt = new Date()
  await EvolutionInstallationModel.findOneAndUpdate({ _id: 'global' }, { $set: { origin, installationId,
    apiKeyCiphertext: encryptEvolutionSecret(parsed.data.adminApiKey), verifiedAt } },
  { upsert: true, runValidators: true })
  return { installation: { baseUrl: origin, verifiedAt: verifiedAt.toISOString() } }
}

export async function listEvolutionInventory(organizationId: string,
  deps: { createClient?: typeof createEvolutionInstallationClient } = {}) {
  if (!await organizationExists(organizationId)) return { error: 'NOT_FOUND' as const }
  try {
    const config = await evolutionAdminConfig()
    if (!config) return { error: 'UNAVAILABLE' as const }
    const client = (deps.createClient ?? createEvolutionInstallationClient)({ ...config, mode: 'real' })
    await client.verify()
    const remote = await client.listInstances()
    const installationId = createHash('sha256').update(new URL(config.baseUrl).origin).digest('hex')
    const local = await EvolutionConnectionModel.find({ installationId, organizationId, archivedAt: { $exists: false } })
      .select('_id instanceName channel state')
    const byName = new Map(local.map(connection => [connection.instanceName as string, connection]))
    return { instances: remote.map(item => {
      const connection = byName.get(item.instanceName)
      const own = connection?.channel === item.channel
      return { ...item, ownership: own ? 'propria' as const : 'protegida' as const,
        ...(own ? { connectionId: String(connection._id), localState: connection.state as string } : {}) }
    }) }
  } catch { return { error: 'UNAVAILABLE' as const } }
}

export async function bindEvolutionConnection(organizationId: string, input: EvolutionBindInput,
  deps: { proveInstance?: typeof proveEvolutionInstance } = {}) {
  const parsed = evolutionBindInput.safeParse(input)
  if (!parsed.success || !/^zingara-[a-z0-9-]{6,80}$/.test(parsed.data.instanceName)) return { error: 'INVALID' as const }
  if (!await organizationExists(organizationId)) return { error: 'NOT_FOUND' as const }
  let config: Awaited<ReturnType<typeof evolutionAdminConfig>>
  try { config = await evolutionAdminConfig() }
  catch { return { error: 'UNAVAILABLE' as const } }
  if (!config) return { error: 'UNAVAILABLE' as const }
  if (parsed.data.token === config.adminApiKey) return { error: 'INVALID' as const }
  const installationId = createHash('sha256').update(new URL(config.baseUrl).origin).digest('hex')
  if (await EvolutionConnectionModel.exists({ instanceName: parsed.data.instanceName })) return { error: 'CONFLICT' as const }
  let remote
  try {
    remote = await (deps.proveInstance ?? proveEvolutionInstance)({ baseUrl: config.baseUrl,
      instanceName: parsed.data.instanceName, token: parsed.data.token, mode: 'real' })
  } catch { return { error: 'INVALID' as const } }
  if (remote.channel !== parsed.data.channel) return { error: 'INVALID' as const }
  const webhookSecret = randomBytes(32).toString('base64url')
  try {
    await EvolutionConnectionModel.init()
    const doc = await EvolutionConnectionModel.create({ organizationId, installationId,
      instanceName: parsed.data.instanceName, channel: parsed.data.channel,
      instanceTokenCiphertext: encryptEvolutionSecret(parsed.data.token),
      webhookSecretCiphertext: encryptEvolutionSecret(webhookSecret), webhookSecretHash: hashEvolutionSecret(webhookSecret),
      ...(parsed.data.channel === 'cloud' ? { metaTokenCiphertext: encryptEvolutionSecret(parsed.data.token),
        metaTokenHash: hashEvolutionSecret(parsed.data.token), phoneNumberId: parsed.data.phoneNumberId,
        businessId: parsed.data.businessId } : {}) })
    return { connection: presentEvolutionConnection(doc) }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return { error: 'CONFLICT' as const }
    throw error
  }
}

function presentEvolutionConnection(doc: any) {
  return { id: String(doc._id), provider: 'evolution' as const, channel: doc.channel as 'baileys' | 'cloud',
    instanceName: doc.instanceName as string, state: doc.state as string,
    ...(doc.phoneNumberId ? { phoneNumberId: doc.phoneNumberId as string } : {}),
    ...(doc.businessId ? { businessId: doc.businessId as string } : {}) }
}

export async function createEvolutionConnection(organizationId: string, input: EvolutionConnectionInput) {
  const parsed = evolutionConnectionInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  if (!await organizationExists(organizationId)) return { error: 'NOT_FOUND' as const }
  const mode = evolutionControlMode()
  if (mode === 'fake' && await hasConfiguredEvolutionInstallation()) return { error: 'UNAVAILABLE' as const }
  if (mode === 'real' && process.env.EVOLUTION_REAL_ENABLED !== '1' &&
    process.env.EVOLUTION_CONTROL_REAL_ENABLED !== '1') return { error: 'UNAVAILABLE' as const }
  let installation: string
  try { installation = await evolutionBaseUrl() }
  catch { return { error: 'UNAVAILABLE' as const } }
  if (!installation || new URL(installation).protocol !== 'https:') return { error: 'UNAVAILABLE' as const }
  const installationId = await currentEvolutionInstallationId()
  await EvolutionConnectionModel.init()
  let doc = await EvolutionConnectionModel.findOne({ organizationId, channel: parsed.data.channel, archivedAt: { $exists: false } })
  if (!doc) {
    const instanceToken = parsed.data.channel === 'cloud' ? parsed.data.metaToken : randomBytes(32).toString('base64url')
    const webhookSecret = randomBytes(32).toString('base64url')
    try {
      doc = await EvolutionConnectionModel.create({ organizationId, installationId,
        instanceName: `zingara-${randomUUID()}`, channel: parsed.data.channel,
        instanceTokenCiphertext: encryptEvolutionSecret(instanceToken),
        webhookSecretCiphertext: encryptEvolutionSecret(webhookSecret),
        webhookSecretHash: hashEvolutionSecret(webhookSecret),
        ...(parsed.data.channel === 'cloud' ? {
          metaTokenCiphertext: encryptEvolutionSecret(parsed.data.metaToken),
          metaTokenHash: hashEvolutionSecret(parsed.data.metaToken),
          phoneNumberId: parsed.data.phoneNumberId, businessId: parsed.data.businessId,
        } : {}),
      })
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
      doc = await EvolutionConnectionModel.findOne({ organizationId, channel: parsed.data.channel, archivedAt: { $exists: false } })
    }
  }
  if (!doc || doc.installationId !== installationId ||
    (parsed.data.channel === 'cloud' && (doc.phoneNumberId !== parsed.data.phoneNumberId ||
      doc.businessId !== parsed.data.businessId || doc.metaTokenHash !== hashEvolutionSecret(parsed.data.metaToken)))) {
    return { error: 'CONFLICT' as const }
  }
  return { connection: presentEvolutionConnection(doc) }
}

export async function listEvolutionConnections(organizationId: string) {
  if (!await organizationExists(organizationId)) return null
  const docs = await EvolutionConnectionModel.find({ organizationId, archivedAt: { $exists: false } }).sort({ channel: 1 })
  return { connections: docs.map(presentEvolutionConnection) }
}

export async function readActiveConnection(organizationId: string) {
  if (!validId(organizationId)) return null
  await connectDatabase()
  const organization = await OrganizationModel.findById(organizationId)
  if (!organization) return null
  const selected = organization.activeConnection
  if (selected?.provider === 'evolution' && selected.connectionId) {
    const connection = await EvolutionConnectionModel.findOne({ _id: selected.connectionId, organizationId,
      installationId: await currentEvolutionInstallationId(),
      archivedAt: { $exists: false } })
    return connection ? { provider: 'evolution' as const,
      channel: selected.channel as 'baileys' | 'cloud',
      connectionId: String(connection._id), revision: selected.revision as number } : null
  }
  return null
}

export async function selectActiveConnection(organizationId: string, connectionId: string, expectedProvider?: 'uazapigo' | 'evolution', expectedRevision?: number) {
  if (!validId(organizationId) || !validId(connectionId)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const [organization, evolution] = await Promise.all([
    OrganizationModel.findById(organizationId),
    EvolutionConnectionModel.findOne({ _id: connectionId, organizationId,
      installationId: await currentEvolutionInstallationId(), archivedAt: { $exists: false },
      state: 'ready' }).select('_id channel'),
  ])
  if (!organization || !evolution) return { error: 'NOT_FOUND' as const }
  const provider = 'evolution' as const
  const channel = evolution.channel as 'baileys' | 'cloud'
  const previous = organization.activeConnection
  if (expectedProvider && expectedProvider !== provider) return { error: 'NOT_FOUND' as const }
  if (expectedRevision !== undefined && expectedRevision !== (previous?.revision || 0)) return { error: 'CONFLICT' as const }
  if (String(previous?.connectionId || '') === connectionId) return { connection: {
    provider, channel, connectionId, revision: previous.revision as number } }
  const revision = (previous?.revision || 0) + 1
  if (previous?.provider === 'evolution' && previous.connectionId) {
    const busy = await EvolutionConnectionModel.exists({ _id: previous.connectionId, organizationId,
      sendLeaseUntil: { $gt: new Date() } })
    if (busy) return { error: 'CONFLICT' as const }
  }
  const updated = await OrganizationModel.findOneAndUpdate({ _id: organizationId,
    ...(previous?.revision ? { 'activeConnection.revision': previous.revision } : { 'activeConnection.revision': { $exists: false } }) },
  { $set: { activeConnection: { provider, channel, connectionId, revision } } }, { returnDocument: 'after' })
  if (!updated) return { error: 'CONFLICT' as const }
  await DeliveryModel.updateMany({ organizationId, status: { $in: ['queued', 'retry_wait', 'processing'] },
    'media.status': { $ne: 'sending' }, 'text.status': { $ne: 'sending' },
    $or: [{ approvedProvider: { $ne: provider } }, { approvedConnectionId: { $ne: connectionId } },
      { approvedConnectionRevision: { $ne: revision } }] },
  { $set: { status: 'suppressed', suppressionReason: 'connection_changed' },
    $unset: { nextAttemptAt: '', leaseUntil: '' } })
  return { connection: { provider, channel, connectionId, revision } }
}

export async function evolutionCredentials(organizationId: string, connectionId: string) {
  if (!validId(organizationId) || !validId(connectionId)) return null
  await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ _id: connectionId, organizationId,
    installationId: await currentEvolutionInstallationId(), archivedAt: { $exists: false } })
    .select('+instanceTokenCiphertext +webhookSecretCiphertext +metaTokenCiphertext')
  if (!connection) return null
  return { ...presentEvolutionConnection(connection),
    instanceToken: decryptEvolutionSecret(connection.instanceTokenCiphertext),
    webhookSecret: decryptEvolutionSecret(connection.webhookSecretCiphertext),
    ...(connection.metaTokenCiphertext ? { metaToken: decryptEvolutionSecret(connection.metaTokenCiphertext) } : {}) }
}

async function evolutionClient(credentials: NonNullable<Awaited<ReturnType<typeof evolutionCredentials>>>) {
  const mode = evolutionControlMode()
  if (mode === 'fake' && await hasConfiguredEvolutionInstallation()) throw new Error('Controle Evolution real desabilitado')
  if (mode === 'real' && process.env.EVOLUTION_REAL_ENABLED !== '1' &&
    process.env.EVOLUTION_CONTROL_REAL_ENABLED !== '1') throw new Error('Evolution real desabilitada')
  return createEvolutionClient({ baseUrl: await evolutionBaseUrl(),
    instanceName: credentials.instanceName, token: credentials.instanceToken, channel: credentials.channel,
    mode })
}

export async function provisionEvolutionConnection(organizationId: string, connectionId: string,
  deps: { createClient?: typeof createEvolutionClient } = {}) {
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  if (credentials.state === 'retiring') return { error: 'BUSY' as const }
  const mode = evolutionControlMode()
  if (mode === 'fake' && await hasConfiguredEvolutionInstallation()) return { error: 'UNAVAILABLE' as const }
  if (mode === 'real' && process.env.EVOLUTION_REAL_ENABLED !== '1' &&
    process.env.EVOLUTION_CONTROL_REAL_ENABLED !== '1') return { error: 'UNAVAILABLE' as const }
  if (credentials.state === 'ready') {
    const connection = { id: credentials.id, provider: 'evolution' as const, channel: credentials.channel,
      instanceName: credentials.instanceName, state: credentials.state,
      ...(credentials.phoneNumberId ? { phoneNumberId: credentials.phoneNumberId } : {}),
      ...(credentials.businessId ? { businessId: credentials.businessId } : {}) }
    if (mode === 'fake') return { connection }
    try {
      const admin = await evolutionAdminConfig()
      if (!admin) return { error: 'UNAVAILABLE' as const }
      const remote = await (deps.createClient ?? createEvolutionClient)({ ...admin,
        instanceName: credentials.instanceName, token: credentials.instanceToken,
        channel: credentials.channel, mode }).getInstance()
      return remote?.instanceName === credentials.instanceName && remote.channel === credentials.channel
        ? { connection } : { error: 'UNAVAILABLE' as const }
    } catch { return { error: 'UNAVAILABLE' as const } }
  }
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 45_000)
  const claimed = await EvolutionConnectionModel.findOneAndUpdate({ _id: connectionId, organizationId,
    $or: [{ createLeaseUntil: { $exists: false } }, { createLeaseUntil: { $lte: now } }] },
  { $set: { state: 'creating', createLeaseUntil: leaseUntil } }, { returnDocument: 'after' })
  if (!claimed) return { error: 'BUSY' as const }
  try {
    const admin = await evolutionAdminConfig()
    if (mode === 'real' && !admin) return { error: 'UNAVAILABLE' as const }
    const config = { baseUrl: admin?.baseUrl || await evolutionBaseUrl(), instanceName: credentials.instanceName,
      token: credentials.instanceToken, channel: credentials.channel, mode,
      ...(admin ? { adminApiKey: admin.adminApiKey } : {}) }
    const client = (deps.createClient ?? createEvolutionClient)(config)
    let instance = await client.getInstanceAsAdmin()
    if (instance) {
      // The global key confirms the name exists; only its own token proves ownership.
      try { instance = await client.getInstance() }
      catch (error) {
        if (error instanceof EvolutionHttpError && [401, 403].includes(error.status)) return { error: 'CONFLICT' as const }
        throw error
      }
      if (!instance) return { error: 'CONFLICT' as const }
    } else {
      try { instance = await client.createInstance(credentials.channel === 'cloud'
        ? { businessId: credentials.businessId!, number: credentials.phoneNumberId! } : undefined) }
      catch (error) {
        if (!(error instanceof EvolutionHttpError) || error.status !== 409) throw error
        instance = await client.getInstance()
        if (!instance) return { error: 'CONFLICT' as const }
      }
    }
    if (instance.instanceName !== credentials.instanceName || instance.channel !== credentials.channel) {
      return { error: 'CONFLICT' as const }
    }
    const origin = process.env.INVITE_ORIGIN || ''
    const url = new URL(`/webhooks/evolution/${connectionId}`, origin)
    if (mode === 'fake' && url.protocol === 'http:') url.protocol = 'https:'
    const webhook = await client.configureWebhook({ url: url.toString(), headerName: 'x-zingara-webhook-secret',
      secret: credentials.webhookSecret,
      events: ['CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE'] })
    const confirmed = await client.getWebhook()
    if (!webhook.enabled || !confirmed?.enabled || confirmed.url !== url.toString()) {
      return { error: 'UNAVAILABLE' as const }
    }
    const updated = await EvolutionConnectionModel.findOneAndUpdate({ _id: connectionId, organizationId, createLeaseUntil: leaseUntil },
      { $set: { state: 'ready' }, $unset: { createLeaseUntil: '' } }, { returnDocument: 'after' })
    return updated ? { connection: presentEvolutionConnection(updated) } : { error: 'BUSY' as const }
  } catch {
    return { error: 'UNAVAILABLE' as const }
  } finally {
    await EvolutionConnectionModel.updateOne({ _id: connectionId, organizationId, createLeaseUntil: leaseUntil },
      { $set: { state: 'error' }, $unset: { createLeaseUntil: '' } })
  }
}

export async function readEvolutionStatus(organizationId: string, connectionId: string) {
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  try {
    const status = await (await evolutionClient(credentials)).getStatus()
    return { status: { state: status.state, mode: evolutionControlMode(),
      ...(credentials.channel === 'baileys' && status.qrCode ? { qrCode: status.qrCode } : {}) } }
  } catch { return { error: 'UNAVAILABLE' as const } }
}

export async function connectEvolution(organizationId: string, connectionId: string) {
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  if (credentials.channel !== 'baileys') return { error: 'UNSUPPORTED' as const }
  try {
    const client = await evolutionClient(credentials)
    const status = await client.getStatus()
    if (status.state === 'connected') return { error: 'BUSY' as const }
    return { status: await client.connect() }
  } catch { return { error: 'UNAVAILABLE' as const } }
}

export async function checkEvolutionNumber(organizationId: string, connectionId: string, phone: string) {
  return checkEvolutionNumberWithQuota(organizationId, connectionId, phone)
}

async function checkEvolutionNumberWithQuota(organizationId: string, connectionId: string, phone: string,
  freshClient?: EvolutionClient) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { error: 'INVALID' as const }
  organizationId = organizationId.toLowerCase()
  connectionId = connectionId.toLowerCase()
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  if (credentials.channel !== 'baileys') return { error: 'UNSUPPORTED' as const }
  if (credentials.state !== 'ready') return { error: 'UNAVAILABLE' as const }
  const active = await readActiveConnection(organizationId)
  if (active?.connectionId !== connectionId) return { error: 'CONFLICT' as const }
  const connection = { id: connectionId, instanceName: credentials.instanceName, revision: active.revision }
  const mode = evolutionControlMode()
  const cacheKey = createHash('sha256').update(JSON.stringify([organizationId, connectionId, active.revision, mode, phone])).digest('hex')
  // Sends require a fresh lookup; diagnostics can reuse the last confirmed result.
  const cached = !freshClient && await NumberVerificationModel.findOne({ _id: cacheKey, expiresAt: { $gt: new Date() } })
  if (cached) return { exists: cached.exists as boolean, checkedAt: cached.checkedAt.toISOString() as string,
    connection, mode, cached: true }
  const window = Math.floor(Date.now() / 60_000)
  const day = Math.floor(Date.now() / 86_400_000)
  let retryAfterSeconds = 60
  try {
    // Shared with individual diagnostics; changing instances must not reset the organization's budget.
    for (const [key, limit, resetAt] of [
      [`evolution-number-org:${organizationId}:${window}`, 10, (window + 1) * 60_000],
      [`evolution-number:${connectionId}:${window}`, 10, (window + 1) * 60_000],
      [`evolution-number-day:${organizationId}:${day}`, 100, (day + 1) * 86_400_000],
    ] as const) {
      retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
      const count = await LoginAttemptModel.updateOne({ _id: key, count: { $lt: limit } },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } }, { upsert: true })
      if (count.modifiedCount !== 1 && count.upsertedCount !== 1) return { error: 'RATE_LIMIT' as const, retryAfterSeconds }
    }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return { error: 'RATE_LIMIT' as const, retryAfterSeconds }
    return { error: 'UNAVAILABLE' as const }
  }
  try {
    const client = freshClient ?? await evolutionClient(credentials)
    if (!freshClient) {
      const status = await client.getStatus()
      if (evolutionControlMode() === 'real' && status.state !== 'connected') return { error: 'UNAVAILABLE' as const }
    }
    const result = await client.checkNumber(phone)
    if (result.number !== phone.replace(/^\+/, '') || typeof result.exists !== 'boolean') {
      return { error: 'UNAVAILABLE' as const }
    }
    const checkedAt = new Date()
    await NumberVerificationModel.updateOne({ _id: cacheKey }, { $set: { exists: result.exists, checkedAt,
      expiresAt: new Date(checkedAt.getTime() + 300_000) } }, { upsert: true })
    return { exists: result.exists, checkedAt: checkedAt.toISOString(), connection, mode, cached: false }
  } catch (error) {
    if (error instanceof EvolutionHttpError && error.status === 429) {
      return { error: 'RATE_LIMIT' as const, retryAfterSeconds: Math.max(60, Math.ceil((error.retryAfterMs || 60_000) / 1000)) }
    }
    return { error: 'UNAVAILABLE' as const }
  }
}

export async function previewEvolutionNumbers(organizationId: string, connectionId: string, input: unknown) {
  const parsed = evolutionNumberPreviewInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  const active = await readActiveConnection(organizationId)
  const preview: EvolutionNumberPreview = { channel: credentials.channel,
    connection: { id: connectionId, instanceName: credentials.instanceName,
      revision: active?.connectionId === connectionId ? active.revision : null },
    lookupSupported: credentials.channel === 'baileys', mode: evolutionControlMode(),
    limits: { batch: 10, perMinute: 10, perDay: 100 },
    results: parsed.data.phones.map(phone => ({ phone, state: !/^\+[1-9]\d{7,14}$/.test(phone)
      ? 'invalid_format' : credentials.channel === 'cloud' ? 'unsupported' : 'not_checked' })),
  }
  return preview
}

export async function verifyEvolutionNumbers(organizationId: string, connectionId: string, input: unknown) {
  const parsed = evolutionNumberVerificationInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  const preview = await previewEvolutionNumbers(organizationId, connectionId, { phones: parsed.data.phones })
  if ('error' in preview) return preview
  if (!preview.lookupSupported) return { error: 'UNSUPPORTED' as const }
  if (preview.connection.revision === null) return { error: 'CONFLICT' as const }
  const results = new Map<string, EvolutionNumberPreview['results'][number]>()
  for (const phone of new Set(parsed.data.phones)) {
    const result = await checkEvolutionNumber(organizationId, connectionId, phone)
    if ('exists' in result) results.set(phone, { phone, state: result.exists ? 'registered' : 'not_registered',
      checkedAt: result.checkedAt, connection: result.connection, cached: result.cached })
    else {
      results.set(phone, { phone, state: result.error === 'RATE_LIMIT' ? 'rate_limited' : 'unavailable',
        ...(result.error === 'RATE_LIMIT' ? { retryAfterSeconds: result.retryAfterSeconds } : {}) })
      break
    }
  }
  return { ...preview, results: parsed.data.phones.map(phone => results.get(phone) ?? { phone, state: 'not_checked' as const }) }
}

export async function retireEvolutionConnection(organizationId: string, connectionId: string,
  deps: { createClient?: typeof createEvolutionClient } = {}) {
  if (!validId(organizationId) || !validId(connectionId)) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ _id: connectionId, organizationId,
    installationId: await currentEvolutionInstallationId(), archivedAt: { $exists: false } })
  if (!connection) return { error: 'NOT_FOUND' as const }
  if (evolutionControlMode() === 'fake' && await hasConfiguredEvolutionInstallation()) {
    return { error: 'UNAVAILABLE' as const }
  }
  if (evolutionControlMode() === 'real' && process.env.EVOLUTION_REAL_ENABLED !== '1' &&
    process.env.EVOLUTION_CONTROL_REAL_ENABLED !== '1') {
    return { error: 'UNAVAILABLE' as const }
  }
  const active = await readActiveConnection(organizationId)
  if (active?.connectionId === connectionId) return { error: 'BUSY' as const }
  const pending = await DeliveryModel.exists({ organizationId, approvedConnectionId: connectionId,
    status: { $in: ['queued', 'processing', 'retry_wait', 'uncertain'] } })
  if (pending) return { error: 'BUSY' as const }
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 60_000)
  const claimed = await EvolutionConnectionModel.findOneAndUpdate({ _id: connectionId, organizationId,
    archivedAt: { $exists: false }, $and: [
      { $or: [{ createLeaseUntil: { $exists: false } }, { createLeaseUntil: { $lte: now } }] },
      { $or: [{ sendLeaseUntil: { $exists: false } }, { sendLeaseUntil: { $lte: now } }] },
    ] }, { $set: { state: 'retiring', createLeaseUntil: leaseUntil } }, { returnDocument: 'after' })
  if (!claimed) return { error: 'BUSY' as const }
  try {
    if ((await readActiveConnection(organizationId))?.connectionId === connectionId ||
      await DeliveryModel.exists({ organizationId, approvedConnectionId: connectionId,
        status: { $in: ['queued', 'processing', 'retry_wait', 'uncertain'] } })) {
      await EvolutionConnectionModel.updateOne({ _id: connectionId, createLeaseUntil: leaseUntil },
        { $set: { state: connection.state } })
      return { error: 'BUSY' as const }
    }
    const credentials = await evolutionCredentials(organizationId, connectionId)
    if (!credentials) return { error: 'NOT_FOUND' as const }
    const client = (deps.createClient ?? createEvolutionClient)({ baseUrl: await evolutionBaseUrl(),
      instanceName: credentials.instanceName, token: credentials.instanceToken,
      channel: credentials.channel, mode: evolutionControlMode() })
    const instance = await client.getInstance()
    if (instance && (instance.instanceName !== credentials.instanceName || instance.channel !== credentials.channel)) {
      return { error: 'CONFLICT' as const }
    }
    if (instance) await client.deleteInstance()
    if (await client.getInstance()) return { error: 'UNAVAILABLE' as const }
    const archived = await EvolutionConnectionModel.updateOne({ _id: connectionId, organizationId,
      createLeaseUntil: leaseUntil, state: 'retiring' },
    { $set: { archivedAt: new Date() }, $unset: { createLeaseUntil: '' } })
    return archived.modifiedCount === 1 ? { removed: true as const } : { error: 'BUSY' as const }
  } catch { return { error: 'UNAVAILABLE' as const } }
  finally {
    await EvolutionConnectionModel.updateOne({ _id: connectionId, organizationId, createLeaseUntil: leaseUntil },
      { $unset: { createLeaseUntil: '' } })
  }
}

export async function listEvolutionTemplates(organizationId: string, connectionId: string) {
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  if (credentials.channel !== 'cloud') return { error: 'UNSUPPORTED' as const }
  const docs = await EvolutionTemplateModel.find({ organizationId, connectionId }).sort({ type: 1 })
  let client: EvolutionClient | null = null
  try { client = await evolutionClient(credentials) } catch { /* diagnóstico indisponível */ }
  const templates = await Promise.all(docs.map(async doc => {
    let status = 'unknown'
    try { status = (await client?.getTemplate(doc.name, doc.language))?.status || 'unknown' }
    catch { /* estado desconhecido bloqueia envio */ }
    return { type: doc.type as string, name: doc.name as string, language: doc.language as string, status }
  }))
  return { templates }
}

export async function saveEvolutionTemplate(organizationId: string, connectionId: string, input: unknown) {
  const parsed = officialTemplateInput.safeParse(input)
  if (!parsed.success) return { error: 'INVALID' as const }
  if (parsed.data.type !== 'initial' && parsed.data.variables?.length) return { error: 'INVALID' as const }
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials) return { error: 'NOT_FOUND' as const }
  if (credentials.channel !== 'cloud') return { error: 'UNSUPPORTED' as const }
  let status: string
  try { status = (await (await evolutionClient(credentials)).getTemplate(parsed.data.name, parsed.data.language))?.status || 'unknown' }
  catch { return { error: 'UNAVAILABLE' as const } }
  if (status !== 'approved') return { error: 'NOT_APPROVED' as const }
  await EvolutionTemplateModel.init()
  const variables = parsed.data.variables || (parsed.data.type === 'initial' ? ['convite.link'] : [])
  const existing = await EvolutionTemplateModel.findOne({ organizationId, connectionId, type: parsed.data.type })
  const revision = existing && (existing.name !== parsed.data.name || existing.language !== parsed.data.language ||
    JSON.stringify(existing.variables) !== JSON.stringify(variables)) ? existing.revision + 1 : existing?.revision || 1
  const updated = await EvolutionTemplateModel.findOneAndUpdate({ organizationId, connectionId, type: parsed.data.type },
    { $set: { name: parsed.data.name, language: parsed.data.language, variables, revision } },
    { upsert: true, returnDocument: 'after', runValidators: true })
  return { template: { type: updated.type as string, name: updated.name as string,
    language: updated.language as string, status } }
}

export async function approvedEvolutionTemplate(organizationId: string, connectionId: string, type: string) {
  const credentials = await evolutionCredentials(organizationId, connectionId)
  if (!credentials || credentials.channel !== 'cloud') return null
  const configured = await EvolutionTemplateModel.findOne({ organizationId, connectionId, type })
  if (!configured) return null
  try {
    const template = await (await evolutionClient(credentials)).getTemplate(configured.name, configured.language)
    if (template?.status !== 'approved') return null
    return { name: configured.name as string, language: configured.language as string,
      variables: configured.variables as string[], revision: configured.revision as number }
  } catch { return null }
}

function presentDeliveryPart(part: any) {
  return { status: part.status as string,
    ...(part.messageId ? { messageId: part.messageId as string } : {}),
    ...(part.chatId ? { chatId: part.chatId as string } : {}),
    ...(part.trackId ? { trackId: part.trackId as string } : {}),
  }
}

function presentDelivery(doc: any, guestName?: string) {
  return { id: doc.id as string, invitationId: String(doc.invitationId), guestName,
    approvedMode: doc.approvedMode as 'fake' | 'real',
    status: doc.status as string, media: presentDeliveryPart(doc.media), text: presentDeliveryPart(doc.text),
    attempts: (doc.attempts as any[]).map(attempt => ({ part: attempt.part as string,
      outcome: attempt.outcome as string, startedAt: attempt.startedAt.toISOString() as string,
      ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt.toISOString() as string } : {}),
      ...(attempt.providerCode ? { providerCode: attempt.providerCode as number } : {}),
    })),
    createdAt: doc.createdAt.toISOString() as string, updatedAt: doc.updatedAt.toISOString() as string,
  }
}

async function activeConnectionRecord(organizationId: string) {
  const active = await readActiveConnection(organizationId)
  if (!active) return null
  const connection = await EvolutionConnectionModel.findOne({ _id: active.connectionId, organizationId,
    archivedAt: { $exists: false } }).select('+instanceTokenCiphertext')
  return connection ? { active, connection } : null
}

async function connectionIdentity(connection: any, active?: { provider: string, channel: string, revision: number }) {
  return { id: String(connection._id), serverUrl: await evolutionBaseUrl(),
    tokenHash: createHash('sha256').update(connection.instanceTokenCiphertext as string).digest('hex'),
    provider: 'evolution' as const, channel: active?.channel || connection.channel as string,
    revision: active?.revision || 0 }
}

export async function activeConnectionIdentity(organizationId: string) {
  const record = await activeConnectionRecord(organizationId)
  if (!record) return null
  const identity = await connectionIdentity(record.connection, record.active)
  return { approvedConnectionId: record.connection._id,
    approvedConnectionServerUrl: identity.serverUrl, approvedConnectionTokenHash: identity.tokenHash,
    approvedProvider: identity.provider, approvedChannel: identity.channel,
    approvedConnectionRevision: identity.revision,
    approvedMode: process.env.EVOLUTION_MODE === 'real'
      ? 'real' as const : 'fake' as const }
}

function initialInvitationEligible(event: any, invitation: any) {
  const now = new Date()
  const expiresAt = Math.min(invitation.expiresAt.getTime(), event.endsAt.getTime())
  return event.status === 'published' && !invitation.revokedAt && expiresAt > now.getTime() &&
    event.rsvpDeadline > now && invitation.responseStatus === 'pending'
}

export async function previewInitialDelivery(organizationId: string, eventId: string, invitationId: string): Promise<
  { preview: { recipient: { name: string, phone: string, whatsappConsent: boolean }, text: string,
    link: string, template: TemplateInput, renderData: Record<TemplateVariable, string>, mode: 'fake' | 'real',
    provider: string, channel: string, officialTemplate?: { name: string, language: string, variables: string[], revision: number },
    previewHash: string } } |
  { error: 'NOT_FOUND' | 'INELIGIBLE' | 'NO_CONNECTION' | 'NO_TEMPLATE' }
> {
  if (![organizationId, eventId, invitationId].every(validId)) return { error: 'NOT_FOUND' }
  await connectDatabase()
  const [event, invitation, activeRecord] = await Promise.all([
    EventModel.findOne({ _id: eventId, organizationId }),
    InvitationModel.findOne({ _id: invitationId, eventId, organizationId }),
    activeConnectionRecord(organizationId),
  ])
  if (!event || !invitation) return { error: 'NOT_FOUND' }
  if (!activeRecord) return { error: 'NO_CONNECTION' }
  if (!initialInvitationEligible(event, invitation)) return { error: 'INELIGIBLE' }
  const [guest, version] = await Promise.all([
    GuestModel.findOne({ _id: invitation.guestId, organizationId }),
    TemplateVersionModel.findOne({ eventId, organizationId,
      version: event.amendmentVersion || invitation.templateVersion }),
  ])
  if (!guest || !version) return { error: 'NOT_FOUND' }
  const officialTemplate = activeRecord.active.channel === 'cloud'
    ? await approvedEvolutionTemplate(organizationId, activeRecord.active.connectionId, 'initial') : undefined
  if (activeRecord.active.channel === 'cloud' && !officialTemplate) return { error: 'NO_TEMPLATE' }
  return renderInitialDeliveryPreview(event, invitation, guest, version, activeRecord.active,
    await connectionIdentity(activeRecord.connection, activeRecord.active), officialTemplate)
}

type InitialDeliveryPreviewResult = Awaited<ReturnType<typeof previewInitialDelivery>>
type InitialDeliveryPreviewItem = Extract<InitialDeliveryPreviewResult, { preview: unknown }>['preview']

export async function previewInitialDeliveries(organizationId: string, eventId: string, invitationIds: string[]): Promise<
  { previews: ({ invitationId: string, eligibleUntil: string } & InitialDeliveryPreviewItem)[] } |
  Extract<InitialDeliveryPreviewResult, { error: unknown }>
> {
  if (![organizationId, eventId, ...invitationIds].every(validId) || !invitationIds.length || invitationIds.length > 200 ||
    new Set(invitationIds.map(id => id.toLowerCase())).size !== invitationIds.length) return { error: 'NOT_FOUND' as const }
  await connectDatabase()
  const [event, invitations, activeRecord] = await Promise.all([
    EventModel.findOne({ _id: eventId, organizationId }),
    InvitationModel.find({ _id: { $in: invitationIds }, eventId, organizationId }),
    activeConnectionRecord(organizationId),
  ])
  if (!event || invitations.length !== invitationIds.length) return { error: 'NOT_FOUND' as const }
  if (!activeRecord) return { error: 'NO_CONNECTION' as const }
  if (invitations.some(invitation => !initialInvitationEligible(event, invitation))) return { error: 'INELIGIBLE' as const }
  const [guests, versions] = await Promise.all([
    GuestModel.find({ _id: { $in: invitations.map(invitation => invitation.guestId) }, organizationId }),
    TemplateVersionModel.find({ eventId, organizationId,
      version: { $in: [...new Set(invitations.map(invitation => event.amendmentVersion || invitation.templateVersion))] } }),
  ])
  const officialTemplate = activeRecord.active.channel === 'cloud'
    ? await approvedEvolutionTemplate(organizationId, activeRecord.active.connectionId, 'initial') : undefined
  if (activeRecord.active.channel === 'cloud' && !officialTemplate) return { error: 'NO_TEMPLATE' as const }
  const identity = await connectionIdentity(activeRecord.connection, activeRecord.active)
  const invitationMap = new Map(invitations.map(invitation => [invitation.id as string, invitation]))
  const guestMap = new Map(guests.map(guest => [guest.id as string, guest]))
  const versionMap = new Map(versions.map(version => [version.version as number, version]))
  const previews: ({ invitationId: string, eligibleUntil: string } & InitialDeliveryPreviewItem)[] = []
  for (const id of invitationIds) {
    const invitation = invitationMap.get(id.toLowerCase())!
    const guest = guestMap.get(String(invitation.guestId))
    const version = versionMap.get(event.amendmentVersion || invitation.templateVersion)
    if (!guest || !version) return { error: 'NOT_FOUND' as const }
    const result = renderInitialDeliveryPreview(event, invitation, guest, version, activeRecord.active, identity, officialTemplate)
    previews.push({ invitationId: id,
      eligibleUntil: new Date(Math.min(event.rsvpDeadline.getTime(), invitation.expiresAt.getTime(),
        event.endsAt.getTime())).toISOString(),
      ...result.preview })
  }
  return { previews }
}

function renderInitialDeliveryPreview(event: any, invitation: any, guest: any, version: any, active: any,
  identity: Awaited<ReturnType<typeof connectionIdentity>>, officialTemplate: Awaited<ReturnType<typeof approvedEvolutionTemplate>> | undefined):
  { preview: InitialDeliveryPreviewItem } {
  const frozenEvent = version.event as Record<string, string | number>
  const link = inviteLink(recoverInviteToken(invitation.secretCiphertext))
  const renderData: Record<TemplateVariable, string> = {
    ...eventTemplateValues({ name: String(frozenEvent.name), location: String(frozenEvent.location),
      startsAt: String(frozenEvent.startsAt), timeZone: String(frozenEvent.timeZone),
      rsvpDeadline: new Date(Math.min(event.rsvpDeadline.getTime(), invitation.expiresAt.getTime(),
        event.endsAt.getTime())).toISOString() }),
    'convidado.nome': guest.name as string,
    'convite.link': link, 'convite.limite_acompanhantes': String(invitation.companionLimit),
  }
  const template = version.template as TemplateInput
  const text = renderEventMessage(template, renderData)
  const recipient = { name: guest.name as string, phone: guest.phone as string,
    whatsappConsent: hasGuestWhatsAppConsent(guest) }
  const mode = process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake'
  const previewHash = createHash('sha256').update(JSON.stringify({ recipient, text, template,
    renderData, invitationVersion: invitation.responseVersion, templateVersion: version.version, mode,
    connection: identity,
    officialTemplate,
  })).digest('hex')
  return { preview: { recipient, text, link, template, renderData, mode,
    provider: active.provider as string, channel: active.channel as string,
    ...(officialTemplate ? { officialTemplate } : {}), previewHash } }
}

export async function approveInitialDelivery(organizationId: string, eventId: string, input: DeliveryApprovalInput,
  campaign?: { campaignId: string }) {
  const data = deliveryApprovalInput.parse(input)
  const result = await previewInitialDelivery(organizationId, eventId, data.invitationId)
  if ('error' in result) return result
  const { preview } = result
  if (!preview.recipient.whatsappConsent || preview.previewHash !== data.previewHash) return { error: 'CONFLICT' as const }
  if (campaign && !await DeliveryCampaignModel.exists({ _id: campaign.campaignId, organizationId, eventId,
    status: { $in: ['draft', 'scheduled', 'running'] },
    items: { $elemMatch: { invitationId: data.invitationId, previewHash: data.previewHash } } })) {
    return { error: 'CONFLICT' as const }
  }
  await DeliveryModel.init()
  const [invitation, activeRecord] = await Promise.all([
    InvitationModel.findById(data.invitationId), activeConnectionRecord(organizationId),
  ])
  if (!invitation || !activeRecord) return { error: 'NOT_FOUND' as const }
  const identity = await connectionIdentity(activeRecord.connection, activeRecord.active)
  const latestPreview = await previewInitialDelivery(organizationId, eventId, data.invitationId)
  if ('error' in latestPreview || latestPreview.preview.previewHash !== preview.previewHash) {
    return { error: 'CONFLICT' as const }
  }
  const approval = { contentHash: preview.previewHash, approvedMode: preview.mode,
    approvedConnectionId: activeRecord.connection._id, approvedConnectionServerUrl: identity.serverUrl,
    approvedConnectionTokenHash: identity.tokenHash, approvedProvider: identity.provider,
    approvedChannel: identity.channel, approvedConnectionRevision: identity.revision,
    ...(preview.officialTemplate ? { approvedTemplateName: preview.officialTemplate.name,
      approvedTemplateLanguage: preview.officialTemplate.language,
      approvedTemplateRevision: preview.officialTemplate.revision } : {}),
    recipientPhone: preview.recipient.phone }
  const event = await EventModel.findOne({ _id: eventId, organizationId, status: 'published' }).select('amendmentVersion')
  if (!event) return { error: 'CONFLICT' as const }
  const filter = { invitationId: data.invitationId, type: 'initial',
    templateVersion: event.amendmentVersion || invitation.templateVersion }
  const existing = await DeliveryModel.findOne(filter)
  if (existing) {
    if (String(existing.campaignId || '') !== (campaign?.campaignId || '')) {
      const previousCampaignId = String(existing.campaignId || '')
      const previousInvalidated = campaign && validId(previousCampaignId) && await DeliveryCampaignModel.exists({
        _id: previousCampaignId, organizationId, eventId, status: 'cancelled', cancellationReason: 'invalidated_draft',
      })
      if (!previousInvalidated) return { error: 'CONFLICT' as const }
      const recovered = await DeliveryModel.findOneAndUpdate({ _id: existing.id, campaignId: previousCampaignId,
        status: { $in: ['queued', 'retry_wait', 'suppressed'] }, 'attempts.0': { $exists: false },
        'media.status': { $nin: ['sending', 'accepted'] }, 'text.status': { $nin: ['sending', 'accepted'] } },
      { $set: { ...approval, campaignId: campaign!.campaignId, status: 'queued', 'media.status': 'skipped',
        'text.status': 'pending', approvedAt: new Date() },
      $unset: { suppressionReason: '', nextAttemptAt: '', leaseUntil: '',
        ...(preview.officialTemplate ? {} : { approvedTemplateName: '', approvedTemplateLanguage: '', approvedTemplateRevision: '' }) } },
      { returnDocument: 'after' })
      return recovered ? { delivery: presentDelivery(recovered, preview.recipient.name), created: false } :
        { error: 'CONFLICT' as const }
    }
    if (existing.contentHash === preview.previewHash && existing.approvedMode === preview.mode &&
      String(existing.approvedConnectionId) === identity.id && existing.approvedConnectionServerUrl === identity.serverUrl &&
      existing.approvedConnectionTokenHash === identity.tokenHash &&
      (existing.approvedProvider || 'uazapigo') === identity.provider &&
      (existing.approvedConnectionRevision || 0) === identity.revision) {
      return { delivery: presentDelivery(existing, preview.recipient.name), created: false }
    }
    const reapproved = await DeliveryModel.findOneAndUpdate({ _id: existing.id,
      contentHash: existing.contentHash, status: { $in: ['queued', 'retry_wait', 'suppressed'] },
      'attempts.0': { $exists: false }, 'media.status': { $nin: ['sending', 'accepted'] },
      'text.status': { $nin: ['sending', 'accepted'] } },
    { $set: { ...approval, status: 'queued', 'media.status': campaign || identity.channel === 'cloud' ? 'skipped' : 'pending',
      'text.status': 'pending', approvedAt: new Date() },
      $unset: { suppressionReason: '', nextAttemptAt: '', leaseUntil: '',
        ...(preview.officialTemplate ? {} : { approvedTemplateName: '', approvedTemplateLanguage: '', approvedTemplateRevision: '' }) } }, { new: true })
    return reapproved ? { delivery: presentDelivery(reapproved, preview.recipient.name), created: false } :
      { error: 'CONFLICT' as const }
  }
  let doc
  try {
    doc = await new DeliveryModel({ ...filter, organizationId, eventId, guestId: invitation.guestId,
      ...(campaign ? { campaignId: campaign.campaignId } : {}),
      ...approval, status: 'queued',
      media: { status: campaign || identity.channel === 'cloud' ? 'skipped' : 'pending' },
      text: { status: 'pending' }, approvedAt: new Date() })
      .save()
  } catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    const winner = await DeliveryModel.findOne(filter)
    if (!winner || winner.contentHash !== preview.previewHash || winner.approvedMode !== preview.mode ||
      String(winner.campaignId || '') !== (campaign?.campaignId || '')) return { error: 'CONFLICT' as const }
    return { delivery: presentDelivery(winner, preview.recipient.name), created: false }
  }
  return { delivery: presentDelivery(doc, preview.recipient.name), created: true }
}

export async function listDeliveries(organizationId: string, eventId: string) {
  if (!validId(organizationId) || !validId(eventId)) return null
  await connectDatabase()
  if (!await EventModel.exists({ _id: eventId, organizationId })) return null
  const docs = await DeliveryModel.find({ organizationId, eventId, type: 'initial' }).sort({ createdAt: -1, _id: -1 })
  const guests = await GuestModel.find({ _id: { $in: docs.map(doc => doc.guestId) }, organizationId }).select('name')
  const names = new Map(guests.map(guest => [guest.id, guest.name as string]))
  return { items: docs.map(doc => presentDelivery(doc, names.get(String(doc.guestId)))) }
}

export async function listDispatchableDeliveryIds(limit = 100): Promise<string[]> {
  await connectDatabase()
  const now = new Date()
  await DeliveryCampaignModel.updateMany({ status: 'scheduled', scheduledAt: { $lte: now },
    approvalHash: { $type: 'string' }, $expr: { $eq: ['$approvalHash', '$previewHash'] } },
  { $set: { status: 'running' } })
  const dispatchable = [
    { $or: [{ status: 'queued' }, { status: 'retry_wait', nextAttemptAt: { $lte: now } },
      { status: 'processing', leaseUntil: { $lte: now } },
      { status: 'processing', leaseUntil: { $exists: false } }] },
    { $or: [{ type: 'initial' }, { type: 'automation', scheduledAt: { $lte: now } }] },
  ]
  await DeliveryModel.updateMany({ approvedProvider: { $ne: 'evolution' }, $and: dispatchable },
    { $set: { status: 'suppressed', suppressionReason: 'legacy_provider' },
      $unset: { nextAttemptAt: '', leaseUntil: '' } })
  const campaigns = await DeliveryCampaignModel.find({ status: 'running', approvalHash: { $type: 'string' },
    $expr: { $eq: ['$approvalHash', '$previewHash'] },
    $or: [{ scheduledAt: { $exists: false } }, { scheduledAt: null }, { scheduledAt: { $lte: now } }] }).select('_id')
  const docs = await DeliveryModel.find({ approvedProvider: 'evolution', $and: [...dispatchable,
    { $or: [{ campaignId: { $exists: false } }, { campaignId: { $in: campaigns.map(doc => doc._id) } }] }] })
    .sort({ createdAt: 1, _id: 1 }).limit(Math.max(1, Math.min(limit, 500))).select('_id')
  return docs.map(doc => doc.id as string)
}

async function pauseEvolutionConnection(connectionId: unknown, organizationId: unknown) {
  const jitter = Math.floor(Math.random() * 15_000)
  const connection = await EvolutionConnectionModel.findOneAndUpdate({ _id: connectionId, organizationId }, [{ $set: {
    unavailableAttempts: { $add: [{ $ifNull: ['$unavailableAttempts', 0] }, 1] },
    unavailableUntil: { $add: ['$$NOW', { $add: [
      { $min: [30 * 60_000, { $multiply: [30_000, { $pow: [2, { $ifNull: ['$unavailableAttempts', 0] }] }] }] },
      jitter,
    ] }] },
  } }], { returnDocument: 'after', updatePipeline: true })
  if (!connection) return null
  return { attempts: connection.unavailableAttempts as number,
    retryMs: Math.max(1_000, (connection.unavailableUntil as Date).getTime() - Date.now()) }
}

type DeliveryDependencies = {
  renderMedia: (invitationId: string, templateVersion: number, invitationLink: string) => Promise<{ url: string, expiresAt: Date }>
  createEvolutionClient?: typeof createEvolutionClient
  evaluateAutomation?: (deliveryId: string) => Promise<
    { eligible: true, text: string, recipientPhone: string } | { eligible: false, reason: string }>
}

export async function processDelivery(id: string, deps: DeliveryDependencies): Promise<void> {
  if (!validId(id)) return
  await connectDatabase()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 120_000)
  const doc = await DeliveryModel.findOneAndUpdate(
    { _id: id, $and: [{ $or: [
      { status: 'queued' }, { status: 'retry_wait', nextAttemptAt: { $lte: now } },
      { status: 'processing', leaseUntil: { $lte: now } }, { status: 'processing', leaseUntil: { $exists: false } },
    ] }, { $or: [{ type: 'initial' }, { type: 'automation', scheduledAt: { $lte: now } }] }] },
    { $set: { status: 'processing', leaseUntil }, $unset: { nextAttemptAt: '' } }, { new: true },
  )
  if (!doc) return
  const deliveryFilter = { _id: id, status: 'processing', leaseUntil }
  if (doc.approvedProvider !== 'evolution') {
    await DeliveryModel.updateOne(deliveryFilter,
      { $set: { status: 'suppressed', suppressionReason: 'legacy_provider' }, $unset: { leaseUntil: '' } })
    return
  }
  const campaignTextOnly = Boolean(doc.campaignId)
  if (campaignTextOnly && !['accepted', 'skipped'].includes(doc.media.status)) {
    await DeliveryModel.updateOne(deliveryFilter, { $set: { 'media.status': 'skipped' } })
  }
  const deliveryParts = campaignTextOnly || doc.type === 'automation' || doc.approvedChannel === 'cloud'
    ? (['text'] as const) : (['media', 'text'] as const)
  const stalePart = deliveryParts.find(part => doc[part].status === 'sending')
  if (stalePart) {
    await DeliveryModel.updateOne(deliveryFilter,
      { $set: { status: 'uncertain', [`${stalePart}.status`]: 'uncertain' }, $unset: { leaseUntil: '' } })
    return
  }

  async function stop(status: 'suppressed' | 'retry_wait' | 'uncertain' | 'failed_permanent', part: 'media' | 'text', reason?: string, retryMs = 60_000, attemptId?: string, providerCode?: number) {
    const timestamp = new Date()
    const update: Record<string, unknown> = {
      status, [`${part}.status`]: status,
      ...(status === 'retry_wait' ? { nextAttemptAt: new Date(timestamp.getTime() + retryMs) } : {}),
      ...(status === 'suppressed' ? { suppressionReason: reason } : {}),
      ...(attemptId ? { 'attempts.$[attempt].outcome': status, 'attempts.$[attempt].finishedAt': timestamp,
        ...(providerCode ? { 'attempts.$[attempt].providerCode': providerCode } : {}) } : {}),
    }
    await DeliveryModel.updateOne(deliveryFilter, { $set: update, $unset: { leaseUntil: '' } },
      attemptId ? { arrayFilters: [{ 'attempt.attemptId': attemptId }] } : undefined)
    if (doc.campaignId) await refreshDeliveryCampaign(String(doc.campaignId))
  }

  let campaignReservation: Date | undefined
  let campaignIntervalMs: number | undefined
  async function campaignAllowsSend(part: 'media' | 'text', reserve = false, reserved = false, attemptId?: string) {
    if (!doc.campaignId) return true
    const sendNow = new Date()
    const filter = { _id: doc.campaignId, organizationId: doc.organizationId, eventId: doc.eventId,
      status: 'running', approvalHash: { $type: 'string' }, $expr: { $eq: ['$approvalHash', '$previewHash'] },
      $or: [{ scheduledAt: { $exists: false } }, { scheduledAt: null }, { scheduledAt: { $lte: sendNow } }],
      items: { $elemMatch: { invitationId: doc.invitationId, previewHash: doc.contentHash } } }
    const campaign = await DeliveryCampaignModel.findOne(filter)
    if (!campaign || !Number.isInteger(campaign.intervalMs) || campaign.intervalMs < 2000 || campaign.intervalMs > 3600000) {
      const waiting = await DeliveryCampaignModel.findOne({ _id: doc.campaignId, organizationId: doc.organizationId,
        eventId: doc.eventId, $or: [{ status: 'draft' },
          { status: { $in: ['paused', 'scheduled'] }, approvalHash: { $type: 'string' },
            $expr: { $eq: ['$approvalHash', '$previewHash'] } }] }).select('status scheduledAt')
      const cancelled = !waiting && await DeliveryCampaignModel.exists({ _id: doc.campaignId,
        organizationId: doc.organizationId, eventId: doc.eventId, status: 'cancelled' })
      const retryMs = waiting?.status === 'scheduled' && waiting.scheduledAt
        ? Math.max(1000, waiting.scheduledAt.getTime() - sendNow.getTime()) : 5000
      await stop(waiting ? 'retry_wait' : 'suppressed', part,
        waiting ? 'campaign_waiting' : cancelled ? 'campaign_cancelled' : 'campaign_not_approved', retryMs, attemptId)
      return false
    }
    campaignIntervalMs = campaign.intervalMs
    if (!reserved && campaign.nextSendAt && campaign.nextSendAt > sendNow) {
      await stop('retry_wait', part, 'campaign_cadence', campaign.nextSendAt.getTime() - sendNow.getTime(), attemptId)
      return false
    }
    if (reserve) {
      const nextSendAt = new Date(sendNow.getTime() + campaign.intervalMs)
      const claimed = await DeliveryCampaignModel.findOneAndUpdate({ ...filter,
        $or: [{ nextSendAt: { $exists: false } }, { nextSendAt: { $lte: sendNow } }] },
      { $set: { nextSendAt } }, { returnDocument: 'after' })
      if (!claimed) { await stop('retry_wait', part, 'campaign_busy', 5000, attemptId); return false }
      campaignReservation = nextSendAt
    }
    if (reserved) {
      const nextSendAt = new Date(sendNow.getTime() + campaign.intervalMs)
      const extended = campaignReservation && await DeliveryCampaignModel.updateOne({ ...filter, nextSendAt: campaignReservation },
        { $set: { nextSendAt } })
      if (!extended?.matchedCount) { await stop('retry_wait', part, 'campaign_reservation_lost', 5000, attemptId); return false }
      campaignReservation = nextSendAt
    }
    return true
  }

  for (const part of deliveryParts) {
    const current = await DeliveryModel.findById(id)
    if (!current || current.status !== 'processing' || current.leaseUntil?.getTime() !== leaseUntil.getTime()) return
    if (current[part].status === 'accepted') continue
    if (!await campaignAllowsSend(part)) return
    let messageText: string
    let invitationLink = ''
    if (current.type === 'automation') {
      if (!deps.evaluateAutomation) { await stop('retry_wait', part, 'evaluator_unavailable'); return }
      let evaluation: Awaited<ReturnType<NonNullable<DeliveryDependencies['evaluateAutomation']>>>
      try { evaluation = await deps.evaluateAutomation(id) }
      catch { await stop('retry_wait', part, 'evaluation_failed'); return }
      if (!evaluation.eligible || evaluation.text !== current.automationText ||
        evaluation.recipientPhone !== current.recipientPhone) {
        await stop('suppressed', part, evaluation.eligible ? 'content_changed' : evaluation.reason); return
      }
      messageText = evaluation.text
    } else {
      const previewResult = await previewInitialDelivery(String(current.organizationId), String(current.eventId), String(current.invitationId))
      if ('error' in previewResult) { await stop('suppressed', part, previewResult.error); return }
      const { preview } = previewResult
      if (!preview.recipient.whatsappConsent || preview.previewHash !== current.contentHash ||
        preview.recipient.phone !== current.recipientPhone || preview.mode !== current.approvedMode) {
        await stop('suppressed', part, 'content_or_consent_changed'); return
      }
      messageText = preview.text
      invitationLink = preview.link
    }
    const activeRecord = await activeConnectionRecord(String(current.organizationId))
    if (!activeRecord) { await stop('suppressed', part, 'no_connection'); return }
    const connection = activeRecord.connection
    const approvedConnection = await connectionIdentity(connection, activeRecord.active)
    if (approvedConnection.id !== String(current.approvedConnectionId) ||
      approvedConnection.serverUrl !== current.approvedConnectionServerUrl ||
      approvedConnection.tokenHash !== current.approvedConnectionTokenHash ||
      approvedConnection.provider !== (current.approvedProvider || 'uazapigo') ||
      approvedConnection.revision !== (current.approvedConnectionRevision || 0)) {
      await stop('suppressed', part, 'connection_changed'); return
    }
    const mode = process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake'
    if (mode !== current.approvedMode) { await stop('suppressed', part, 'mode_changed'); return }
    async function stillEligible() {
      if (current.type === 'automation') {
        if (!deps.evaluateAutomation) return false
        const evaluation = await deps.evaluateAutomation(id)
        return evaluation.eligible && evaluation.text === messageText &&
          evaluation.recipientPhone === current.recipientPhone &&
          (await activeConnectionIdentity(String(current.organizationId)))?.approvedConnectionRevision ===
            (current.approvedConnectionRevision || 0) &&
          (await activeConnectionIdentity(String(current.organizationId)))?.approvedConnectionTokenHash ===
            current.approvedConnectionTokenHash
      }
      const [freshPreviewResult, freshRecord] = await Promise.all([
        previewInitialDelivery(String(current.organizationId), String(current.eventId), String(current.invitationId)),
        activeConnectionRecord(String(current.organizationId)),
      ])
      const freshIdentity = freshRecord ? await connectionIdentity(freshRecord.connection, freshRecord.active) : null
      return 'preview' in freshPreviewResult && freshPreviewResult.preview.recipient.whatsappConsent &&
        freshPreviewResult.preview.previewHash === current.contentHash &&
        freshPreviewResult.preview.recipient.phone === current.recipientPhone &&
        freshPreviewResult.preview.mode === current.approvedMode &&
        freshIdentity?.id === approvedConnection.id && freshIdentity?.serverUrl === approvedConnection.serverUrl &&
        freshIdentity?.tokenHash === approvedConnection.tokenHash &&
        freshIdentity?.revision === approvedConnection.revision && freshIdentity?.provider === approvedConnection.provider &&
        (process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake') === current.approvedMode
    }
    if (mode === 'real' && (process.env.EVOLUTION_REAL_ENABLED !== '1' || process.env.EVOLUTION_REAL_SEND_ENABLED !== '1')) {
      await stop('suppressed', part, 'real_send_disabled'); return
    }
    let client: EvolutionClient
    try {
      const nextAvailable = connection.unavailableUntil as Date | undefined
      if (nextAvailable && nextAvailable > now) {
        await stop('retry_wait', part, 'connection_unavailable', nextAvailable.getTime() - now.getTime()); return
      }
      client = (deps.createEvolutionClient ?? createEvolutionClient)({
        baseUrl: approvedConnection.serverUrl, instanceName: connection.instanceName,
        token: decryptEvolutionSecret(connection.instanceTokenCiphertext),
        channel: approvedConnection.channel as 'baileys' | 'cloud', mode,
        realSendEnabled: mode === 'real', allowedDestinations: [current.recipientPhone],
      })
      const status = await client.getStatus()
      if (mode === 'real' && status.state !== 'connected') {
        const pause = await pauseEvolutionConnection(connection._id, current.organizationId)
        if (!pause || pause.attempts > 6) { await stop('failed_permanent', part, 'connection_unavailable'); return }
        await stop('retry_wait', part, 'connection_unavailable', pause.retryMs); return
      }
      await EvolutionConnectionModel.updateOne({ _id: connection._id, organizationId: current.organizationId },
        { $set: { unavailableAttempts: 0 }, $unset: { unavailableUntil: '' } })
    } catch {
      const pause = await pauseEvolutionConnection(connection._id, current.organizationId)
      if (!pause || pause.attempts > 6) { await stop('failed_permanent', part, 'connection_error'); return }
      await stop('retry_wait', part, 'connection_error', pause.retryMs); return
    }
    let mediaUrl: string | undefined
    if (part === 'media') {
      try {
        const rendered = await deps.renderMedia(String(current.invitationId), current.templateVersion, invitationLink)
        const origin = process.env.INVITE_ORIGIN
        const url = new URL(rendered.url)
        if (!origin || url.origin !== new URL(origin).origin ||
          (mode === 'real' && url.protocol !== 'https:') || rendered.expiresAt.getTime() < Date.now() + 60_000) {
          throw new Error('Arte temporária inválida')
        }
        mediaUrl = url.toString()
      } catch { await stop('retry_wait', part, 'artwork_unavailable', 60_000); return }
    }
    let eligibleBeforeLease: boolean
    try { eligibleBeforeLease = await stillEligible() }
    catch { await stop('retry_wait', part, 'eligibility_check_failed', 60_000); return }
    if (!eligibleBeforeLease) { await stop('suppressed', part, 'eligibility_changed_before_send'); return }
    if (!await campaignAllowsSend(part)) return
    const sendNow = new Date()
    const connectionLeaseUntil = new Date(sendNow.getTime() + 60_000)
    const leaseFilter = { _id: connection._id, organizationId: current.organizationId,
      $or: [{ sendLeaseUntil: { $exists: false } }, { sendLeaseUntil: { $lte: sendNow } }],
      $and: [{ $or: [{ nextSendAt: { $exists: false } }, { nextSendAt: { $lte: sendNow } }] }] }
    const leaseUpdate = { $set: { sendLeaseUntil: connectionLeaseUntil,
      nextSendAt: new Date(sendNow.getTime() + (mode === 'real' ? 2_000 : 0)) } }
    const claimedConnection = await EvolutionConnectionModel.findOneAndUpdate({ ...leaseFilter,
      instanceTokenCiphertext: connection.instanceTokenCiphertext }, leaseUpdate, { returnDocument: 'after' })
    if (!claimedConnection) { await stop('retry_wait', part, 'connection_busy', 3_000); return }
    const attemptId = randomUUID()
    let connectionCampaignReservation: Date | undefined
    let providerCallStarted = false
    try {
      if (approvedConnection.channel === 'baileys') {
        try {
          const result = await checkEvolutionNumberWithQuota(String(current.organizationId), String(connection._id),
            current.recipientPhone, client)
          if ('error' in result) {
            await stop('retry_wait', part, 'number_check_unavailable', result.error === 'RATE_LIMIT'
              ? Math.max(60_000, result.retryAfterSeconds * 1000) : 60_000)
            return
          }
          if (!result.exists) { await stop('suppressed', part, 'number_not_registered'); return }
        } catch (error) {
          const retryMs = error instanceof EvolutionHttpError && error.status === 429
            ? Math.max(60_000, error.retryAfterMs || 60_000) : 60_000
          await stop('retry_wait', part, 'number_check_unavailable', retryMs)
          return
        }
      }
      let eligibleAtSend: boolean
      try { eligibleAtSend = await stillEligible() }
      catch { await stop('retry_wait', part, 'eligibility_check_failed', 60_000); return }
      if (!eligibleAtSend) {
        await stop('suppressed', part, 'eligibility_changed_before_send'); return
      }
      if (doc.campaignId) {
        if (!campaignIntervalMs || campaignIntervalMs < 2000 || campaignIntervalMs > 3600000) {
          await stop('suppressed', part, 'campaign_not_approved'); return
        }
        const reservationNow = new Date()
        const nextCampaignSendAt = new Date(reservationNow.getTime() + campaignIntervalMs)
        const reservedConnection = await EvolutionConnectionModel.findOneAndUpdate({
          _id: connection._id, organizationId: current.organizationId,
          instanceTokenCiphertext: connection.instanceTokenCiphertext,
          $or: [{ nextCampaignSendAt: { $exists: false } }, { nextCampaignSendAt: { $lte: reservationNow } }],
        }, { $set: { nextCampaignSendAt } }, { returnDocument: 'after' })
        if (!reservedConnection) {
          const busyConnection = await EvolutionConnectionModel.findOne({ _id: connection._id,
            organizationId: current.organizationId }).select('nextCampaignSendAt')
          const retryMs = busyConnection?.nextCampaignSendAt
            ? Math.max(1000, busyConnection.nextCampaignSendAt.getTime() - reservationNow.getTime()) : 3000
          await stop('retry_wait', part, 'campaign_connection_cadence', retryMs)
          return
        }
        connectionCampaignReservation = nextCampaignSendAt
      }
      if (!await campaignAllowsSend(part, true)) return
      const marked = await DeliveryModel.findOneAndUpdate(deliveryFilter,
        { $set: { [`${part}.status`]: 'sending' },
          $push: { attempts: { attemptId, part, startedAt: sendNow, outcome: 'started' } } }, { new: true })
      if (!marked) return
      async function eligibleToCallProvider() {
        let eligible: boolean
        try { eligible = await stillEligible() }
        catch { await stop('retry_wait', part, 'eligibility_check_failed', 60_000, attemptId); return false }
        if (!eligible) { await stop('suppressed', part, 'eligibility_changed_before_send', 0, attemptId); return false }
        return campaignAllowsSend(part, false, true, attemptId)
      }
      let result: { messageId: string, chatId?: string, trackId?: string }
      {
        const evolution = client
        if (approvedConnection.channel === 'cloud') {
          const configured = await EvolutionTemplateModel.findOne({ organizationId: current.organizationId,
            connectionId: connection._id, name: current.approvedTemplateName,
            language: current.approvedTemplateLanguage, revision: current.approvedTemplateRevision })
          const status = configured && await evolution.getTemplate(configured.name, configured.language)
          if (!configured || status?.status !== 'approved') {
            await stop('suppressed', part, 'template_not_approved', 0, attemptId); return
          }
          const values = current.type === 'initial'
            ? (await previewInitialDelivery(String(current.organizationId), String(current.eventId), String(current.invitationId)))
            : null
          if (values && 'error' in values) { await stop('suppressed', part, 'template_data_changed', 0, attemptId); return }
          const renderData: Record<string, string> = values && 'preview' in values ? values.preview.renderData : {}
          const components = configured.variables.length ? [{ type: 'body', parameters: configured.variables.map((variable: string) =>
            ({ type: 'text', text: String(renderData[variable] || '') })) }] : []
          if (!await eligibleToCallProvider()) return
          providerCallStarted = true
          result = await evolution.sendTemplate({ number: current.recipientPhone,
            name: configured.name, language: configured.language, components })
        } else if (part === 'media') {
          if (!await eligibleToCallProvider()) return
          providerCallStarted = true
          result = await evolution.sendMedia({ number: current.recipientPhone, media: mediaUrl!, mediatype: 'image' })
        } else {
          if (!await eligibleToCallProvider()) return
          providerCallStarted = true
          result = await evolution.sendText({ number: current.recipientPhone, text: messageText })
        }
      }
      const completed = part === 'text' || marked.text.status === 'accepted'
      await DeliveryModel.updateOne(deliveryFilter,
        { $set: { [`${part}.status`]: 'accepted', [`${part}.messageId`]: result.messageId,
          ...(result.chatId ? { [`${part}.chatId`]: result.chatId } : {}),
          ...(result.trackId ? { [`${part}.trackId`]: result.trackId } : {}),
          [`${part}.acceptedAt`]: new Date(), 'attempts.$[attempt].outcome': 'accepted',
          'attempts.$[attempt].finishedAt': new Date(), ...(completed ? { status: 'completed' } : {}) },
          ...(completed ? { $unset: { leaseUntil: '' } } : {}) },
        { arrayFilters: [{ 'attempt.attemptId': attemptId }] })
      if (completed) {
        if (doc.campaignId) await refreshDeliveryCampaign(String(doc.campaignId))
        return
      }
    } catch (error: unknown) {
      if (error instanceof EvolutionHttpError && error.status === 429) {
        await stop('retry_wait', part, 'provider_rate_limit', error.retryAfterMs ?? 60_000, attemptId, 429)
      } else if (error instanceof EvolutionHttpError && error.status >= 400 && error.status < 500) {
        await stop('failed_permanent', part, 'provider_rejected', 0, attemptId, error.status)
      } else await stop('uncertain', part, 'provider_timeout_or_unknown', 0, attemptId)
      return
    } finally {
      if (connectionCampaignReservation && !providerCallStarted) {
        await EvolutionConnectionModel.updateOne({ _id: connection._id,
          organizationId: current.organizationId, nextCampaignSendAt: connectionCampaignReservation },
        { $unset: { nextCampaignSendAt: '' } })
      }
      await EvolutionConnectionModel.updateOne({ _id: connection._id, sendLeaseUntil: connectionLeaseUntil },
        { $unset: { sendLeaseUntil: '' } })
    }
  }
}

async function allowUnknownWebhookAttempt() {
  const configured = Number(process.env.WEBHOOK_UNKNOWN_LIMIT)
  const limit = Number.isInteger(configured) && configured >= 1 && configured <= 120 ? configured : 60
  const windowMs = 60_000
  const window = Math.floor(Date.now() / windowMs)
  const key = `webhook-unknown:${window}`
  try {
    const result = await LoginAttemptModel.updateOne(
      { _id: key, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) } },
      { upsert: true },
    )
    return result.modifiedCount === 1 || result.upsertedCount === 1
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false
    throw error
  }
}

export async function allowEvolutionWebhookAttempt(sourceIp: string) {
  await connectDatabase()
  const limit = webhookLimit('WEBHOOK_ATTEMPT_LIMIT', 120, 100_000)
  const windowMs = 60_000
  const window = Math.floor(Date.now() / windowMs)
  const subject = createHash('sha256').update(sourceIp.slice(0, 128) || 'unknown').digest('hex')
  const key = `webhook-attempt:${subject}:${window}`
  try {
    const result = await LoginAttemptModel.updateOne(
      { _id: key, count: { $lt: limit } },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) } },
      { upsert: true },
    )
    return result.modifiedCount === 1 || result.upsertedCount === 1
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false
    throw error
  }
}

function webhookLimit(name: string, fallback: number, maximum: number) {
  const configured = Number(process.env[name])
  return Number.isInteger(configured) && configured >= 1 && configured <= maximum ? configured : fallback
}

async function takeWebhookQuota(connectionId: string, dedupKey: string) {
  if (await WebhookInboxModel.exists({ dedupKey })) return { duplicate: true as const }
  const minute = Math.floor(Date.now() / 60_000)
  const expiresAt = new Date((minute + 2) * 60_000)
  const buckets = [
    [`webhook-global:${minute}`, webhookLimit('WEBHOOK_GLOBAL_LIMIT', 3000, 100_000)],
    [`webhook-connection:${connectionId}:${minute}`, webhookLimit('WEBHOOK_CONNECTION_LIMIT', 300, 10_000)],
  ] as const
  const taken: string[] = []
  for (const [key, limit] of buckets) {
    try {
      const result = await LoginAttemptModel.updateOne({ _id: key, count: { $lt: limit } },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true })
      if (result.modifiedCount === 1 || result.upsertedCount === 1) { taken.push(key); continue }
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    }
    await Promise.all(taken.map(id => LoginAttemptModel.updateOne({ _id: id, count: { $gt: 0 } }, { $inc: { count: -1 } })))
    return { limited: true as const }
  }
  return { duplicate: false as const }
}

export async function ingestEvolutionWebhook(connectionId: string, secret: string, input: unknown) {
  if (!validId(connectionId) || !secret || secret.length > 4096) return { error: 'UNAUTHORIZED' as const }
  await connectDatabase()
  const connection = await EvolutionConnectionModel.findOne({ _id: connectionId, archivedAt: { $exists: false } })
    .select('organizationId instanceName webhookSecretHash')
  if (!connection) return { error: await allowUnknownWebhookAttempt() ? 'UNAUTHORIZED' as const : 'RATE_LIMIT' as const }
  const expected = Buffer.from(connection.webhookSecretHash, 'hex')
  const received = Buffer.from(hashEvolutionSecret(secret), 'hex')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { error: 'UNAUTHORIZED' as const }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'INVALID' as const }
  const payload = input as Record<string, unknown>
  if (payload.instance !== connection.instanceName) return { error: 'UNAUTHORIZED' as const }
  if (typeof payload.event !== 'string' || !['connection.update', 'messages.upsert', 'messages.update', 'send.message'].includes(payload.event) ||
    !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) return { error: 'INVALID' as const }
  const data = payload.data as Record<string, unknown>
  const key = data.key && typeof data.key === 'object' && !Array.isArray(data.key)
    ? data.key as Record<string, unknown> : {}
  let kind: 'connection' | 'messages_update' | 'messages'
  let minimal: Record<string, unknown>
  let eventKey: unknown
  if (payload.event === 'connection.update') {
    const state = String(data.state || data.connection || '').toLowerCase()
    if (!['open', 'connected', 'connecting', 'close', 'disconnected'].includes(state)) return { error: 'INVALID' as const }
    kind = 'connection'
    minimal = { connectionState: state === 'open' ? 'connected' : state === 'close' ? 'disconnected' : state }
    eventKey = [state, payload.date_time || '']
  } else if (payload.event === 'messages.upsert') {
    const messageId = typeof key.id === 'string' ? key.id : typeof data.id === 'string' ? data.id : ''
    const sender = typeof key.remoteJid === 'string' ? key.remoteJid : ''
    const message = data.message && typeof data.message === 'object' && !Array.isArray(data.message)
      ? data.message as Record<string, unknown> : {}
    const extended = message.extendedTextMessage && typeof message.extendedTextMessage === 'object'
      ? message.extendedTextMessage as Record<string, unknown> : {}
    if (!messageId || messageId.length > 512 || sender.length > 512) return { error: 'INVALID' as const }
    kind = 'messages'
    minimal = { messageId, sender, chatId: sender, fromMe: key.fromMe === true,
      isGroup: sender.endsWith('@g.us'), text: String(message.conversation || extended.text || '').trim().slice(0, 128) }
    eventKey = messageId
  } else {
    const messageId = typeof data.keyId === 'string' ? data.keyId : typeof data.messageId === 'string' ? data.messageId
      : typeof key.id === 'string' ? key.id : ''
    const status = typeof data.status === 'string' ? data.status.toLowerCase() : ''
    if (!messageId || messageId.length > 512 || !status || status.length > 64) return { error: 'INVALID' as const }
    kind = 'messages_update'
    minimal = { messageIds: [messageId], receiptState: status }
    eventKey = [messageId, status]
  }
  const dedupKey = createHash('sha256').update(JSON.stringify([connectionId, payload.event, eventKey])).digest('hex')
  await WebhookInboxModel.init()
  const quota = await takeWebhookQuota(connectionId, dedupKey)
  if ('limited' in quota) return { error: 'RATE_LIMIT' as const }
  if (quota.duplicate) return { accepted: true as const, duplicate: true }
  try {
    await WebhookInboxModel.create({ organizationId: connection.organizationId, connectionId: connection._id,
      provider: 'evolution', kind, status: 'pending', dedupKey, ...minimal })
    return { accepted: true as const, duplicate: false }
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
      return { accepted: true as const, duplicate: true }
    }
    throw error
  }
}

export async function listPendingWebhookIds(limit = 100): Promise<string[]> {
  await connectDatabase()
  const now = new Date()
  const rows = await WebhookInboxModel.find({ $or: [
    { status: 'pending' }, { status: 'retry_wait', nextAttemptAt: { $lte: now } },
    { status: 'processing', leaseUntil: { $lte: now } },
  ] }).sort({ createdAt: 1, _id: 1 }).limit(Math.max(1, Math.min(limit, 500))).select('_id')
  return rows.map(row => row.id as string)
}

const receiptRank: Record<string, number> = { pending: 0, server_ack: 1, sent: 1,
  delivery_ack: 2, delivered: 2, read_ack: 3, read: 3, played: 4 }

export async function processWebhookInbox(id: string): Promise<{
  organizationId: string, kind: 'connection' | 'receipt' | 'opt_out' | 'ignored', guestId?: string
} | null> {
  if (!validId(id)) return null
  await connectDatabase()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 60_000)
  const row = await WebhookInboxModel.findOneAndUpdate({ _id: id, $or: [
    { status: 'pending' }, { status: 'retry_wait', nextAttemptAt: { $lte: now } },
    { status: 'processing', leaseUntil: { $lte: now } },
  ] }, { $set: { status: 'processing', leaseUntil }, $unset: { nextAttemptAt: '' }, $inc: { attempts: 1 } }, { new: true })
  if (!row) return null
  const result: { organizationId: string, kind: 'connection' | 'receipt' | 'opt_out' | 'ignored', guestId?: string } =
    { organizationId: String(row.organizationId), kind: 'ignored' }
  try {
    if (row.provider === 'evolution' && row.kind === 'connection') {
      const state = String(row.connectionState || '')
      if (['connected', 'connecting', 'disconnected', 'hibernated'].includes(state)) {
        await EvolutionConnectionModel.updateOne({ _id: row.connectionId,
          $or: [{ webhookStateAt: { $exists: false } }, { webhookStateAt: { $lte: row.createdAt } }] },
        { $set: { webhookState: state, webhookStateAt: row.createdAt } })
        result.kind = 'connection'
      }
    } else if (row.provider === 'evolution' && row.kind === 'messages_update') {
      const state = String(row.receiptState || '').toLowerCase()
      const rank = receiptRank[state]
      if (rank !== undefined && rank > 0) {
        const normalized = rank === 1 ? 'Sent' : rank === 2 ? 'Delivered' : rank === 3 ? 'Read' : 'Played'
        for (const messageId of row.messageIds as string[]) {
          for (const part of ['media', 'text'] as const) {
            await DeliveryModel.updateMany({ organizationId: row.organizationId,
              approvedConnectionId: row.connectionId, [`${part}.messageId`]: messageId,
              $or: [{ [`${part}.receiptRank`]: { $exists: false } }, { [`${part}.receiptRank`]: { $lt: rank } }] },
            { $set: { [`${part}.receiptRank`]: rank, [`${part}.receiptStatus`]: normalized,
              [`${part}.receiptAt`]: row.receiptAt || row.createdAt } })
          }
        }
        result.kind = 'receipt'
      }
    } else if (row.provider === 'evolution' && row.kind === 'messages' && row.fromMe === false && row.isGroup === false &&
      /^(PARAR|STOP)$/i.test(String(row.text || '').trim())) {
      const sender = String(row.sender || '')
      const match = /^([1-9]\d{7,14})(?:@s\.whatsapp\.net)?$/.exec(sender)
      if (match && (!row.chatId || row.chatId === sender)) {
        const phone = `+${match[1]}`
        const guests = await GuestModel.find({ organizationId: row.organizationId, phone }).select('_id')
        if (guests.length) {
          const guestIds = guests.map(guest => guest._id)
          await GuestModel.updateMany({ _id: { $in: guestIds }, organizationId: row.organizationId },
            { $set: { whatsappConsent: false }, $min: { whatsappOptedOutAt: row.createdAt } })
          await DeliveryModel.updateMany({ organizationId: row.organizationId, guestId: { $in: guestIds },
            status: { $in: ['queued', 'retry_wait', 'processing'] },
            'media.status': { $ne: 'sending' }, 'text.status': { $ne: 'sending' } },
          { $set: { status: 'suppressed', suppressionReason: 'guest_opt_out' },
            $unset: { leaseUntil: '', nextAttemptAt: '' } })
          result.kind = 'opt_out'
          result.guestId = String(guestIds[0])
        }
      }
    }
    const processedAt = new Date()
    const retentionDays = webhookLimit('WEBHOOK_RETENTION_DAYS', 30, 90)
    await WebhookInboxModel.updateOne({ _id: id, status: 'processing', leaseUntil },
      { $set: { status: 'done', processedAt,
        expiresAt: new Date(processedAt.getTime() + retentionDays * 86_400_000) }, $unset: { leaseUntil: '' } })
    return result
  } catch {
    await WebhookInboxModel.updateOne({ _id: id, status: 'processing', leaseUntil },
      { $set: { status: 'retry_wait', nextAttemptAt: new Date(Date.now() + 60_000) }, $unset: { leaseUntil: '' } })
    return null
  }
}

export async function listReconcilableDeliveryIds(limit = 100): Promise<string[]> {
  await connectDatabase()
  const now = new Date()
  const docs = await DeliveryModel.find({ status: 'uncertain',
    $and: [
      { $or: [{ reconcileAttempts: { $lt: 3 } }, { reconcileAttempts: { $exists: false } }] },
      { $or: [{ nextReconcileAt: { $exists: false } }, { nextReconcileAt: { $lte: now } }] },
      { $or: [{ reconcileLeaseUntil: { $exists: false } }, { reconcileLeaseUntil: { $lte: now } }] },
    ] }).sort({ updatedAt: 1, _id: 1 }).limit(Math.max(1, Math.min(limit, 100))).select('_id')
  return docs.map(doc => doc.id as string)
}

export async function reconcileUncertainDelivery(id: string, deps: { createEvolutionClient?: typeof createEvolutionClient } = {}) {
  if (!validId(id)) return null
  await connectDatabase()
  const now = new Date()
  const leaseUntil = new Date(now.getTime() + 60_000)
  const doc = await DeliveryModel.findOneAndUpdate({ _id: id, status: 'uncertain',
    $and: [
      { $or: [{ reconcileAttempts: { $lt: 3 } }, { reconcileAttempts: { $exists: false } }] },
      { $or: [{ nextReconcileAt: { $exists: false } }, { nextReconcileAt: { $lte: now } }] },
      { $or: [{ reconcileLeaseUntil: { $exists: false } }, { reconcileLeaseUntil: { $lte: now } }] },
    ] }, { $set: { reconcileLeaseUntil: leaseUntil, nextReconcileAt: new Date(now.getTime() + 5 * 60_000) },
    $inc: { reconcileAttempts: 1 } }, { new: true })
  if (!doc) return null
  const filter = { _id: id, status: 'uncertain', reconcileLeaseUntil: leaseUntil }
  try {
    if (doc.approvedProvider !== 'evolution') return 'pending' as const
    const connection = await EvolutionConnectionModel.findOne({ _id: doc.approvedConnectionId,
      organizationId: doc.organizationId }).select('+instanceTokenCiphertext')
    if (!connection || !connection.instanceTokenCiphertext) return 'pending' as const
    const identity = await connectionIdentity(connection)
    const mode = process.env.EVOLUTION_MODE === 'real' ? 'real' : 'fake'
    if (mode !== doc.approvedMode || identity.serverUrl !== doc.approvedConnectionServerUrl ||
      identity.tokenHash !== doc.approvedConnectionTokenHash) return 'pending' as const
    const client = (deps.createEvolutionClient ?? createEvolutionClient)({
      baseUrl: identity.serverUrl, instanceName: connection.instanceName,
      token: decryptEvolutionSecret(connection.instanceTokenCiphertext),
      channel: connection.channel, mode,
    })
    for (const part of ['media', 'text'] as const) {
      const messageId = doc[part].messageId as string | undefined
      if (doc[part].status !== 'uncertain' || !messageId) continue
      const match = await client.findMessage(messageId)
      if (!match || match.messageId !== messageId) continue
      const state = String(match.status).toLowerCase()
      if (!receiptRank[state]) continue
      await DeliveryModel.updateOne({ ...filter, [`${part}.status`]: 'uncertain' }, { $set: {
        [`${part}.status`]: 'accepted', [`${part}.acceptedAt`]: new Date(),
        [`${part}.receiptStatus`]: state === 'sent' ? 'Sent' : state === 'delivered' ? 'Delivered' : 'Read',
        [`${part}.receiptRank`]: receiptRank[state], [`${part}.receiptAt`]: new Date(),
      } })
    }
    const latest = await DeliveryModel.findById(id)
    if (latest && ['accepted', 'skipped'].includes(latest.media.status) && latest.text.status === 'accepted') {
      await DeliveryModel.updateOne(filter, { $set: { status: 'completed' }, $unset: { nextReconcileAt: '' } })
      if (doc.campaignId) await refreshDeliveryCampaign(String(doc.campaignId))
      return 'reconciled' as const
    }
    if (latest && !(['uncertain', 'sending'].includes(latest.media.status) ||
      ['uncertain', 'sending'].includes(latest.text.status))) {
      await DeliveryModel.updateOne(filter, { $set: { status: 'queued' }, $unset: { nextReconcileAt: '' } })
      return 'reconciled' as const
    }
    return 'pending' as const
  } catch {
    return 'pending' as const
  } finally {
    await DeliveryModel.updateOne({ _id: id, reconcileLeaseUntil: leaseUntil }, { $unset: { reconcileLeaseUntil: '' } })
  }
}

const ASSISTANT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000
const ASSISTANT_MESSAGE_LIMIT = 30

function presentAssistantConversation(doc: any) {
  return {
    messages: (doc?.messages ?? []).map((message: any) => ({
      role: message.role as 'user' | 'assistant',
      content: sanitizeAssistantText(String(message.content)),
      createdAt: new Date(message.createdAt).toISOString(),
    })),
    pending: sanitizeAssistantPending(doc?.pending) ?? null,
  }
}

export async function readAssistantConversation(adminId: string, organizationId: string) {
  if (!adminId || !validId(organizationId) || !await organizationExists(organizationId)) return null
  await connectDatabase()
  return presentAssistantConversation(await AssistantConversationModel.findOne({ adminId, organizationId }))
}

export async function saveAssistantExchange(
  adminId: string,
  organizationId: string,
  userContent: string,
  assistantContent: string,
  pending?: Record<string, unknown>,
) {
  if (!adminId || !validId(organizationId) || !await organizationExists(organizationId)) return null
  await connectDatabase()
  const now = new Date()
  const safePending = sanitizeAssistantPending(pending)
  const update: Record<string, unknown> = {
    $set: { expiresAt: new Date(now.getTime() + ASSISTANT_RETENTION_MS), ...(safePending ? { pending: safePending } : {}) },
    $push: { messages: { $each: [
      { role: 'user', content: sanitizeAssistantText(userContent), createdAt: now },
      { role: 'assistant', content: sanitizeAssistantText(assistantContent), createdAt: now },
    ], $slice: -ASSISTANT_MESSAGE_LIMIT } },
    $setOnInsert: { adminId, organizationId },
    ...(safePending ? {} : { $unset: { pending: '' } }),
  }
  const doc = await AssistantConversationModel.findOneAndUpdate(
    { adminId, organizationId }, update, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  )
  return presentAssistantConversation(doc)
}

export async function consumeAssistantQuota(adminId: string, organizationId: string) {
  if (!adminId || !validId(organizationId)) return false
  await connectDatabase()
  const take = async (key: string, limit: number, expiresAt: Date) => {
    try {
      const result = await LoginAttemptModel.findOneAndUpdate(
        { _id: key, $or: [{ count: { $lt: limit } }, { count: { $exists: false } }] },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      return Boolean(result)
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false
      throw error
    }
  }
  const minute = Math.floor(Date.now() / 60_000)
  const minuteKey = `assistant:minute:${createHash('sha256').update(`${adminId}:${organizationId}`).digest('hex')}:${minute}`
  if (!await take(minuteKey, 6, new Date((minute + 2) * 60_000))) return false
  const day = Math.floor(Date.now() / 86_400_000)
  const dailyKey = `assistant:day:${createHash('sha256').update(adminId).digest('hex')}:${day}`
  return take(dailyKey, 100, new Date((day + 2) * 86_400_000))
}

export async function assistantContext(organizationId: string, requestMessage = '') {
  if (!await organizationExists(organizationId)) return null
  const normalized = requestMessage.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const includeEvents = /\b(eventos?|convites?|automacoes?|entregas?)\b/.test(normalized)
  const includeGuests = /\b(convidados?|contatos?|convites?)\b/.test(normalized)
  const [events, guests, active] = await Promise.all([
    includeEvents ? listEvents(organizationId, { page: 1, limit: 20 }) : null,
    includeGuests ? listGuests(organizationId, { page: 1, limit: 20 }) : null,
    readActiveConnection(organizationId),
  ])
  let connection: null | { id: string, channel: string, state?: string } = null
  if (active) {
    const local = await EvolutionConnectionModel.findOne({ _id: active.connectionId, organizationId,
      archivedAt: { $exists: false } }).select('channel state')
    if (local) connection = { id: local.id, channel: local.channel as string, state: local.state as string }
  }
  const now = new Date()
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Campo_Grande', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]))
  return {
    organizationId,
    currentDateTime: { utc: now.toISOString(),
      local: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-04:00`,
      timeZone: 'America/Campo_Grande' as const, utcOffset: '-04:00' as const },
    events: events?.items.map(event => ({ id: event.id, name: event.name, status: event.status })) ?? [],
    guests: guests?.items.map(guest => ({ id: guest.id, name: guest.name })) ?? [],
    connection,
  }
}

type AssistantExecution = {
  reply: string
  navigation?: AssistantNavigation
  pending?: Record<string, unknown>
}

type AssistantMutationCategory = 'event' | 'guest' | 'invitation' | 'connection'

function actionMutationCategory(action: AssistantDecision['action']): AssistantMutationCategory | null {
  if (action === 'create_event') return 'event'
  if (action === 'create_guest') return 'guest'
  if (action === 'create_invitation' || action === 'create_full_invitation') return 'invitation'
  if (action === 'prepare_connection') return 'connection'
  return null
}

function deniesMutation(message: string) {
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  return /\b(?:cancele|cancelar|desista|desistir)\b/.test(normalized) ||
    /\b(?:nao|nunca|jamais)\s+(?:crie|criar|cadastre|cadastrar|salve|salvar|adicione|adicionar|gere|gerar|emita|emitir|prepare|preparar|configure|configurar|conecte|conectar)\b/.test(normalized)
}

function explicitMutationCategory(message: string): AssistantMutationCategory | null {
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
  if (message.includes('?') || deniesMutation(message)) return null
  const prefix = '^(?:(?:por favor|agora)[, ]+)*(?:(?:eu )?(?:quero|preciso|desejo)(?: que (?:voce )?)? |(?:voce )?pode )?'
  if (new RegExp(`${prefix}(?:crie|criar|gere|gerar|emita|emitir)\\b.*\\bconvite\\b`).test(normalized)) return 'invitation'
  if (new RegExp(`${prefix}(?:crie|criar|cadastre|cadastrar|salve|salvar|adicione|adicionar)\\b.*\\bevento\\b`).test(normalized)) return 'event'
  if (new RegExp(`${prefix}(?:crie|criar|cadastre|cadastrar|salve|salvar|adicione|adicionar)\\b.*\\b(?:convidado|contato)\\b`).test(normalized)) return 'guest'
  if (new RegExp(`${prefix}(?:crie|criar|prepare|preparar|configure|configurar|conecte|conectar)\\b.*\\b(?:whatsapp|instancia|conexao)\\b`).test(normalized)) return 'connection'
  return null
}

function continuesPendingMutation(
  message: string,
  pending: Record<string, unknown> | null | undefined,
  expected: AssistantMutationCategory | null,
) {
  if (!expected || pendingMutationCategory(pending) !== expected || deniesMutation(message) || message.includes('?')) return false
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
  const fields = pending?.fields && typeof pending.fields === 'object' ? pending.fields as Record<string, unknown> : {}
  const missing = ['eventName', 'eventLocation', 'eventAddress', 'startsAt', 'endsAt', 'rsvpDeadline', 'timeZone',
    'guestName', 'guestPhone', 'whatsappConsent', 'authorizationSource', 'eventId', 'guestId']
    .some(key => fields[key] === '' || fields[key] === null)
  return missing && Boolean(normalized) &&
    !/^(mostre|liste|abra|explique|consulte|veja|como|qual|quais|onde|quando|por que|status|envie|enviar|crie|criar|cadastre|cadastrar|configure|configurar|conecte|conectar)\b/.test(normalized)
}

function pendingMutationCategory(pending?: Record<string, unknown> | null): AssistantMutationCategory | null {
  if (pending?.intent !== 'assistant_flow' || !pending.fields || typeof pending.fields !== 'object') return null
  const category = (pending.fields as Record<string, unknown>).authorizedAction
  return ['event', 'guest', 'invitation', 'connection'].includes(String(category))
    ? category as AssistantMutationCategory : null
}

function assistantFlowPending(
  modelPending: Record<string, unknown> | undefined,
  currentPending: Record<string, unknown> | null | undefined,
  sourceMessage: string,
) {
  if (deniesMutation(sourceMessage)) return undefined
  const category = explicitMutationCategory(sourceMessage) ?? pendingMutationCategory(currentPending)
  const parsed = sanitizeAssistantPending(modelPending)
  const safe = parsed?.intent === 'assistant_flow' ? undefined : parsed
  if (!category) return safe
  const currentFields = currentPending?.fields && typeof currentPending.fields === 'object'
    ? currentPending.fields as Record<string, unknown> : {}
  return { intent: 'assistant_flow', fields: { ...safe?.fields, authorizedAction: category,
    requestedWhatsAppSend: requestsWhatsAppSend(sourceMessage) || currentFields.requestedWhatsAppSend === true } }
}

function pendingRequestsWhatsAppSend(pending?: Record<string, unknown> | null) {
  return Boolean(pending?.requestedWhatsAppSend === true ||
    (pending?.intent === 'assistant_flow' && pending.fields && typeof pending.fields === 'object' &&
      (pending.fields as Record<string, unknown>).requestedWhatsAppSend === true))
}

function requestsWhatsAppSend(message: string) {
  const normalized = message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const send = /\b(enviar|envie|manda|mandar|disparar|dispare)\b/
  const channel = /\b(whatsapp|mensagem|convite)\b/
  return send.test(normalized) && channel.test(normalized)
}

function neutralModelReply(pending?: Record<string, unknown>) {
  const labels: Record<string, string> = {
    eventName: 'nome do evento', eventLocation: 'local', eventAddress: 'endereço', startsAt: 'data e hora de início',
    endsAt: 'data e hora de término', rsvpDeadline: 'prazo de confirmação', timeZone: 'fuso horário',
    guestName: 'nome do convidado', guestPhone: 'telefone do convidado', whatsappConsent: 'consentimento para WhatsApp',
    authorizationSource: 'origem da autorização para WhatsApp',
    eventId: 'evento', guestId: 'convidado',
  }
  const fields = pending?.fields && typeof pending.fields === 'object' ? pending.fields as Record<string, unknown> : {}
  const missing = Object.entries(fields).filter(([key, value]) => key in labels && (value === '' || value === null))
    .map(([key]) => labels[key])
  return missing.length
    ? `Ainda não executei nenhuma ação. Preciso destes dados para continuar: ${missing.join(', ')}.`
    : 'Ainda não executei nenhuma ação. Informe os dados que faltam ou peça explicitamente a próxima ação.'
}

function claimsUnverifiedSuccess(reply: string) {
  const normalized = reply.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const assertions = normalized.replace(/\b(?:verificar|consultar|checar|conferir)\s+se\b[^.!?;]*/g, '')
  return /(?<!nao )(?<!nunca )(?<!jamais )(?<!nem )\b(?:criei|cadastrei|salvei|gerei|emiti|enviei|disparei|conectei|preparei)\b/.test(assertions) ||
    /\btudo pronto\b/.test(assertions) ||
    /\b(?:(?:o|a|um|uma)\s+)?(?:(?:seu|sua|este|esta|esse|essa)\s+)?(?:evento|convidado|convite|mensagem|instancia|conexao|whatsapp)\s+(?:(?:foi|esta|ja foi|ja esta)\s+)?(?:criad[oa]|cadastrad[oa]|salv[oa]|gerad[oa]|emitid[oa]|enviad[oa]|disparad[oa]|conectad[oa]|ativ[oa]|pront[oa]|feit[oa])\b/.test(assertions)
}

function normalizedAssistantCommand(message: string) {
  return message.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
    .replace(/[.!]+$/g, '').replace(/\s+/g, ' ')
}

function confirmsAssistantProposal(message: string) {
  return /^(?:confirmo|sim,? confirmo|pode executar|sim,? pode executar|pode criar|sim,? pode criar)$/.test(
    normalizedAssistantCommand(message),
  )
}

function cancelsAssistantProposal(message: string) {
  return /^(?:nao|nao,? obrigado|nao quero|nao quero mais|deixa|deixa pra la|esquece|pare|cancele|cancela|cancelar)$/.test(
    normalizedAssistantCommand(message),
  )
}

function eventProposalSummary(event: EventInput) {
  return `evento: nome="${sanitizeAssistantText(event.name)}"; descrição="${sanitizeAssistantText(event.description ?? '')}"; ` +
    `local="${sanitizeAssistantText(event.location)}"; endereço="${sanitizeAssistantText(event.address)}"; ` +
    `início=${event.startsAt}; fim=${event.endsAt}; prazo=${event.rsvpDeadline}; fuso=${event.timeZone}; ` +
    `limite de acompanhantes=${event.companionLimit}; nomes dos acompanhantes obrigatórios=${event.companionNamesRequired ? 'sim' : 'não'}`
}

function guestProposalSummary(guest: GuestInput) {
  return `convidado: nome="${sanitizeAssistantText(guest.name)}"; telefone=${guest.phone}; ` +
    `e-mail=${guest.email ?? 'não informado'}; etiquetas="${guest.tags.join(', ')}"; ` +
    `notas="${sanitizeAssistantText(guest.notes)}"; consentimento WhatsApp=${guest.whatsappConsent ? 'sim' : 'não'}` +
    (guest.whatsappConsent ? `; origem="${sanitizeAssistantText(guest.authorizationSource ?? '')}"` : '')
}

function proposalSummary(proposal: AssistantProposal) {
  if (proposal.action === 'create_event') return eventProposalSummary(proposal.event)
  if (proposal.action === 'create_guest') return guestProposalSummary(proposal.guest)
  if (proposal.action === 'create_invitation') {
    return `convite: evento=${proposal.eventId}; convidado=${proposal.guestId}; ` +
      `expiração=${proposal.expiresAt ?? 'padrão do evento'}`
  }
  if (proposal.action === 'create_full_invitation') {
    return `convite completo: ${eventProposalSummary(proposal.event)}; ${guestProposalSummary(proposal.guest)}`
  }
  return 'Preparar uma conexão própria do WhatsApp pela Evolution API.'
}

function assistantProposalResult(
  proposal: AssistantProposal,
  sourceMessage: string,
  currentPending?: Record<string, unknown> | null,
): AssistantExecution {
  const requestedWhatsAppSend = requestsWhatsAppSend(sourceMessage) || pendingRequestsWhatsAppSend(currentPending)
  const pending = sanitizeAssistantPending({
    intent: 'assistant_proposal', proposal, requestedWhatsAppSend,
  })
  if (!pending?.proposal) return { reply: 'Não consegui preparar uma proposta válida. Nenhuma alteração foi executada.' }
  const reply = `Revise a proposta: ${proposalSummary(pending.proposal)} Confirme para executar exatamente estes dados.`
  if (reply.length > 2_000) {
    return {
      reply: 'Não preparei a proposta porque os textos são longos demais para revisar integralmente no chat. Use o editor correspondente.',
      navigation: { type: 'area', area: pending.proposal.action === 'create_guest' ? 'guests' : 'events' },
    }
  }
  return {
    reply,
    pending,
  }
}

function duplicateKey(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000)
}

async function getOrCreateAssistantEvent(organizationId: string, input: EventInput, operationKey: string) {
  const data = eventInput.parse(input)
  await EventModel.init()
  const filter = { organizationId, assistantOperationKey: operationKey }
  let doc
  try {
    doc = await EventModel.findOneAndUpdate(
      filter,
      { $setOnInsert: { ...eventDates(data), organizationId, status: 'draft', assistantOperationKey: operationKey } },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
    )
  } catch (error: unknown) {
    if (!duplicateKey(error)) throw error
    doc = await EventModel.findOne(filter)
  }
  if (!doc) throw new Error('ASSISTANT_EVENT_NOT_CONFIRMED')
  return presentEvent(doc)
}

async function getOrCreateAssistantGuest(organizationId: string, input: GuestInput, operationKey: string, adminId: string) {
  const { authorizationSource, ...data } = guestInput.parse(input)
  await GuestModel.init()
  const filter = { organizationId, assistantOperationKey: operationKey }
  let doc
  try {
    doc = await GuestModel.findOneAndUpdate(
      filter,
      { $setOnInsert: { ...data, organizationId, assistantOperationKey: operationKey,
        ...(data.whatsappConsent ? { whatsappAuthorization: guestAuthorization(authorizationSource, adminId) } : {}) } },
      { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true },
    )
  } catch (error: unknown) {
    if (!duplicateKey(error)) throw error
    doc = await GuestModel.findOne(filter)
  }
  if (!doc) throw new Error('ASSISTANT_GUEST_NOT_CONFIRMED')
  return presentGuest(doc)
}

async function executeConnectionStatus(organizationId: string): Promise<AssistantExecution> {
  const active = await readActiveConnection(organizationId)
  if (!active) return { reply: 'O WhatsApp ainda não tem uma conexão ativa. Abri a configuração para você conectar uma instância própria.',
    navigation: { type: 'area', area: 'connection' } }
  const result = await readEvolutionStatus(organizationId, active.connectionId)
  if ('error' in result || result.status.state !== 'connected') {
    return { reply: 'O WhatsApp ainda não está conectado. Abri a configuração para você continuar pelo QR Code.',
      navigation: { type: 'area', area: 'connection' } }
  }
  return { reply: 'O WhatsApp está conectado. O assistente não aprova nem dispara envios; use a prévia do evento para revisar a entrega.',
    navigation: { type: 'area', area: 'events' } }
}

export async function executeAssistantPendingCommand(
  organizationId: string,
  sourceMessage: string,
  currentPending?: Record<string, unknown> | null,
  adminId = '',
): Promise<AssistantExecution | null> {
  const pending = sanitizeAssistantPending(currentPending)
  if (pending?.intent !== 'assistant_proposal' || !pending.proposal) return null
  if (cancelsAssistantProposal(sourceMessage)) {
    return { reply: 'Cancelei a proposta. Nenhuma alteração foi executada.' }
  }
  if (pending.proposal.organizationId !== organizationId) {
    return { reply: 'Não executei a proposta porque ela não pertence à organização atual.' }
  }
  if (confirmsAssistantProposal(sourceMessage)) {
    return executeAssistantDecisionInternal(organizationId, pending.proposal, '', pending, true, adminId)
  }
  return {
    reply: 'Há uma proposta pendente. Confirme para executar ou cancele para fazer um novo pedido.',
    pending,
  }
}

async function executeAssistantDecisionInternal(
  organizationId: string,
  decision: AssistantDecision,
  sourceMessage: string,
  currentPending?: Record<string, unknown> | null,
  confirmedProposal = false,
  adminId = '',
): Promise<AssistantExecution> {
  if (!confirmedProposal) {
    const pendingCommand = await executeAssistantPendingCommand(organizationId, sourceMessage, currentPending, adminId)
    if (pendingCommand) return pendingCommand
  }
  if ('organizationId' in decision && decision.organizationId !== organizationId) {
    return { reply: 'Não consegui concluir: a ação não pertence à organização atual.' }
  }
  if (!await organizationExists(organizationId)) return { reply: 'Não encontrei a organização atual.' }
  const expectedMutation = actionMutationCategory(decision.action)
  const explicitMutation = explicitMutationCategory(sourceMessage)
  const continuedMutation = !explicitMutation && continuesPendingMutation(sourceMessage, currentPending, expectedMutation)
  if (!confirmedProposal && expectedMutation && explicitMutation !== expectedMutation && !continuedMutation) {
    return { reply: 'Não executei a ação. Para autorizar uma alteração, peça explicitamente para criar, cadastrar ou configurar o item.',
      pending: assistantFlowPending(undefined, currentPending, sourceMessage) }
  }
  if ((decision.action === 'create_event' || decision.action === 'create_full_invitation') &&
    /\b(semana que vem|proxima semana|m[eê]s que vem|algum dia)\b/i.test(
      sourceMessage.normalize('NFD').replace(/\p{Diacritic}/gu, ''),
    )) return { reply: 'Preciso da data e hora exatas do evento antes de criar o convite.' }
  if (!confirmedProposal && expectedMutation) {
    return assistantProposalResult(decision as AssistantProposal, sourceMessage, currentPending)
  }
  if (decision.action === 'respond') {
    if (!explicitMutation && (requestsWhatsAppSend(sourceMessage) || /\b(whatsapp|inst[aâ]ncia|conex[aã]o|qr(?: code)?)\b/i.test(sourceMessage))) {
      return executeConnectionStatus(organizationId)
    }
    const pending = assistantFlowPending(decision.pending, currentPending, sourceMessage)
    const reply = pending || claimsUnverifiedSuccess(decision.reply)
      ? neutralModelReply(pending)
      : sanitizeAssistantText(decision.reply)
    return { reply, ...(pending ? { pending } : {}) }
  }
  if (decision.action === 'navigate') {
    if (decision.navigation.type === 'event' && !await getEvent(organizationId, decision.navigation.eventId)) {
      return { reply: 'Não encontrei esse evento na organização atual.' }
    }
    return { reply: 'Abri a área solicitada.', navigation: decision.navigation }
  }
  if (decision.action === 'connection_status') return executeConnectionStatus(organizationId)
  if (decision.action === 'create_event') {
    const operationKey = createHash('sha256').update(JSON.stringify({ organizationId, event: decision.event })).digest('hex')
    const event = await getOrCreateAssistantEvent(organizationId, decision.event, operationKey)
    return event
      ? { reply: `Evento criado com sucesso. Identificador: ${event.id}.`, navigation: { type: 'event', area: 'events', eventId: event.id } }
      : { reply: 'Não consegui criar o evento na organização atual.' }
  }
  if (decision.action === 'create_guest') {
    const operationKey = createHash('sha256').update(JSON.stringify({ organizationId, guest: decision.guest })).digest('hex')
    const guest = await getOrCreateAssistantGuest(organizationId, decision.guest, operationKey, adminId)
    return guest
      ? { reply: `Convidado criado com sucesso. Identificador: ${guest.id}.`, navigation: { type: 'area', area: 'guests' } }
      : { reply: 'Não consegui criar o convidado na organização atual.' }
  }
  if (decision.action === 'create_invitation') {
    const result = await createInvitation(organizationId, decision.eventId, {
      guestId: decision.guestId, ...(decision.expiresAt ? { expiresAt: decision.expiresAt } : {}),
    })
    if ('error' in result) return { reply: result.error === 'NOT_PUBLISHED'
      ? 'Não criei o convite porque o evento ainda não foi publicado. Abri o modelo para você revisar e publicar.'
      : 'Não consegui criar o convite com o evento e convidado informados.',
      navigation: { type: 'event', area: result.error === 'NOT_PUBLISHED' ? 'template' : 'invitations', eventId: decision.eventId } }
    const completed = { reply: `Convite ${result.created ? 'criado' : 'já existente'} com sucesso. Identificador: ${result.invitation.id}.`,
      navigation: { type: 'event', area: 'invitations', eventId: decision.eventId } as AssistantNavigation }
    if (!requestsWhatsAppSend(sourceMessage) && !pendingRequestsWhatsAppSend(currentPending)) return completed
    const send = await executeConnectionStatus(organizationId)
    return { reply: `${completed.reply} ${send.reply}`, navigation: send.navigation ?? completed.navigation }
  }
  if (decision.action === 'create_full_invitation') {
    const eventOperationKey = createHash('sha256').update(JSON.stringify({ organizationId,
      event: decision.event })).digest('hex')
    const event = await getOrCreateAssistantEvent(organizationId, decision.event, eventOperationKey)
    const eventDoc = await EventModel.findById(event.id).select('+assistantOperationKey templateDraft publishedTemplateVersion')
    if (!eventDoc?.templateDraft) {
      const draft = await saveTemplateDraft(organizationId, event.id, defaultTemplate)
      if (!draft) return { reply: `Criei o evento ${event.id}, mas não consegui salvar o modelo padrão.`,
        navigation: { type: 'event', area: 'template', eventId: event.id },
        pending: { intent: 'complete_invitation', fields: { eventId: event.id } } }
    }
    if (!(eventDoc?.publishedTemplateVersion > 0)) {
      let publication = await publishTemplate(organizationId, event.id, async () => true)
      if ('error' in publication) {
        const current = await EventModel.findOne({ _id: event.id, organizationId }).select('publishedTemplateVersion')
        if (!(current?.publishedTemplateVersion > 0)) publication = await publishTemplate(organizationId, event.id, async () => true)
      }
      if ('error' in publication) {
        const current = await EventModel.findOne({ _id: event.id, organizationId }).select('publishedTemplateVersion')
        if (!(current?.publishedTemplateVersion > 0)) return { reply: `Criei o evento ${event.id} e salvei o modelo, mas não consegui publicá-lo.`,
          navigation: { type: 'event', area: 'template', eventId: event.id },
          pending: { intent: 'complete_invitation', fields: { eventId: event.id } } }
      }
    }
    const guestOperationKey = createHash('sha256').update(JSON.stringify({ organizationId,
      eventId: event.id, guest: decision.guest })).digest('hex')
    const guest = await getOrCreateAssistantGuest(organizationId, decision.guest, guestOperationKey, adminId)
    const invitation = await createInvitation(organizationId, event.id, { guestId: guest.id })
    if ('error' in invitation) return { reply: `Criei o evento ${event.id}, publiquei o modelo e criei o convidado ${guest.id}, mas não consegui emitir o convite.`,
      navigation: { type: 'event', area: 'invitations', eventId: event.id },
      pending: { intent: 'complete_invitation', fields: { eventId: event.id, guestId: guest.id } } }
    const completed = { reply: `Convite completo criado. Evento: ${event.id}. Convidado: ${guest.id}. Convite: ${invitation.invitation.id}.`,
      navigation: { type: 'event', area: 'invitations', eventId: event.id } as AssistantNavigation }
    if (!requestsWhatsAppSend(sourceMessage) && !pendingRequestsWhatsAppSend(currentPending)) return completed
    const send = await executeConnectionStatus(organizationId)
    return { reply: `${completed.reply} ${send.reply}`, navigation: send.navigation ?? completed.navigation }
  }
  const existing = await listEvolutionConnections(organizationId)
  const baileys = existing?.connections.find(connection => connection.channel === 'baileys')
  let connection = baileys
  if (!connection) {
    const created = await createEvolutionConnection(organizationId, { channel: 'baileys' })
    if ('error' in created) return { reply: 'Não consegui reservar uma instância própria do WhatsApp. Verifique a instalação Evolution.',
      navigation: { type: 'area', area: 'connection' } }
    connection = created.connection
  }
  const provisioned = await provisionEvolutionConnection(organizationId, connection.id)
  if ('error' in provisioned) {
    return { reply: `A conexão própria foi reservada, mas a Evolution não concluiu a preparação. Identificador: ${connection.id}.`,
      navigation: { type: 'area', area: 'connection' } }
  }
  const current = await readEvolutionStatus(organizationId, connection.id)
  if (!('error' in current) && current.status.state === 'connected') {
    return { reply: 'A instância própria já está conectada. Abri a configuração para você revisar o número.',
      navigation: { type: 'area', area: 'connection' } }
  }
  if (!('error' in current) && (current.status.state === 'connecting' || current.status.qrCode)) {
    return { reply: current.status.qrCode
      ? 'A instância própria está preparada. Abri a configuração; escaneie o QR Code exibido ali para conectar o número.'
      : 'A instância própria está conectando. Abri a configuração para acompanhar o estado.',
    navigation: { type: 'area', area: 'connection' } }
  }
  const connected = await connectEvolution(organizationId, connection.id)
  if ('error' in connected) return { reply: `A instância própria foi criada, mas a conexão ainda não está pronta. Identificador: ${connection.id}. Continue pelo console.`,
    navigation: { type: 'area', area: 'connection' } }
  return { reply: connected.status.qrCode
    ? 'A instância própria está preparada. Abri a configuração; escaneie o QR Code exibido ali para conectar o número.'
    : 'A instância própria está preparada. Abri a configuração para concluir a conexão.',
  navigation: { type: 'area', area: 'connection' } }
}

export async function executeAssistantDecision(
  organizationId: string,
  decision: AssistantDecision,
  sourceMessage: string,
  currentPending?: Record<string, unknown> | null,
  adminId = '',
) {
  return executeAssistantDecisionInternal(organizationId, decision, sourceMessage, currentPending, false, adminId)
}
