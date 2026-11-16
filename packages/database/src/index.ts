import mongoose from 'mongoose'

const { Schema, model, models } = mongoose

let pending: Promise<typeof mongoose> | undefined
let deliveryIndexesReady: Promise<void> | undefined

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    deliveryIndexesReady ??= migrateDeliveryIndexes().catch(error => { deliveryIndexesReady = undefined; throw error })
    await deliveryIndexesReady
    return mongoose
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI ausente')
  pending ??= mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }).finally(() => {
    pending = undefined
  })
  const db = await pending
  deliveryIndexesReady ??= migrateDeliveryIndexes().catch(error => { deliveryIndexesReady = undefined; throw error })
  await deliveryIndexesReady
  return db
}

const adminSchema = new Schema({
  _id: { type: String, default: 'global' },
  email: { type: String, required: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true, versionKey: false })

const sessionSchema = new Schema({
  _id: String,
  adminId: { type: String, required: true },
  csrfToken: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false })

const loginAttemptSchema = new Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false })

const numberVerificationSchema = new Schema({
  _id: String,
  exists: { type: Boolean, required: true },
  checkedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { versionKey: false })

const assistantMessageSchema = new Schema({
  role: { type: String, required: true, enum: ['user', 'assistant'] },
  content: { type: String, required: true, maxlength: 2_000 },
  createdAt: { type: Date, required: true },
}, { _id: false })

const assistantConversationSchema = new Schema({
  adminId: { type: String, required: true },
  organizationId: { type: Schema.Types.ObjectId, required: true },
  messages: { type: [assistantMessageSchema], default: [] },
  pending: Schema.Types.Mixed,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true, versionKey: false })
assistantConversationSchema.index({ adminId: 1, organizationId: 1 }, { unique: true })

const organizationSchema = new Schema({
  name: { type: String, required: true },
  activeConnection: {
    provider: { type: String, enum: ['uazapigo', 'evolution'] },
    channel: { type: String, enum: ['uazapi', 'baileys', 'cloud'] },
    connectionId: Schema.Types.ObjectId,
    revision: { type: Number, min: 1 },
  },
  visualIdentity: {
    primaryColor: String,
    logoUrl: String,
  },
  settings: { replyToEmail: String },
}, { timestamps: true, versionKey: false })

const eventSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  assistantOperationKey: { type: String, select: false },
  name: { type: String, required: true },
  description: String,
  location: { type: String, required: true },
  address: { type: String, required: true },
  status: { type: String, required: true, enum: ['draft', 'published', 'cancelled'], default: 'draft' },
  cancelledAt: Date,
  templateDraft: Schema.Types.Mixed,
  templateDraftRevision: { type: Number, default: 0 },
  publishedTemplateVersion: { type: Number, default: 0 },
  amendmentVersion: { type: Number, default: 0 },
  revision: { type: Number, default: 0 },
  changeVersion: { type: Number, default: 0 },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  rsvpDeadline: { type: Date, required: true },
  timeZone: { type: String, required: true },
  companionLimit: { type: Number, required: true },
  companionNamesRequired: { type: Boolean, required: true },
}, { timestamps: true, versionKey: false })
eventSchema.index({ organizationId: 1, assistantOperationKey: 1 }, {
  unique: true, partialFilterExpression: { assistantOperationKey: { $type: 'string' } },
})

const guestSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  assistantOperationKey: { type: String, select: false },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: String,
  tags: { type: [String], default: [] },
  notes: { type: String, default: '' },
  whatsappConsent: { type: Boolean, default: false },
  whatsappOptedOutAt: Date,
  importBatchId: String,
  importLine: Number,
  importSourceHash: { type: String, select: false },
  whatsappAuthorization: { source: String, confirmedBy: String, confirmedAt: Date },
}, { timestamps: true, versionKey: false })
guestSchema.index({ organizationId: 1, phone: 1 })
guestSchema.index({ organizationId: 1, assistantOperationKey: 1 }, {
  unique: true, partialFilterExpression: { assistantOperationKey: { $type: 'string' } },
})
guestSchema.index({ organizationId: 1, importBatchId: 1, importLine: 1 }, {
  unique: true, partialFilterExpression: { importBatchId: { $type: 'string' } },
})

const guestImportBatchSchema = new Schema({
  _id: { type: String, required: true },
  sourceHash: { type: String, required: true },
}, { timestamps: true, versionKey: false })

const guestImportPhoneSchema = new Schema({
  _id: { type: String, required: true },
  guestId: { type: String, required: true },
}, { versionKey: false })

const templateVersionSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true, min: 1 },
  sourceDraftRevision: { type: Number, required: true },
  sourceEventUpdatedAt: { type: Date, required: true },
  template: { type: Schema.Types.Mixed, required: true },
  event: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false })
templateVersionSchema.index({ eventId: 1, version: 1 }, { unique: true })

const invitationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  eventId: { type: Schema.Types.ObjectId, required: true },
  guestId: { type: Schema.Types.ObjectId, required: true },
  templateVersion: { type: Number, required: true, min: 1 },
  secretHash: { type: String, required: true, unique: true },
  secretCiphertext: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  rsvpDeadline: { type: Date, required: true },
  companionLimit: { type: Number, required: true },
  companionNamesRequired: { type: Boolean, required: true },
  revokedAt: Date,
  responseStatus: { type: String, required: true, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  companions: { type: [String], default: [] },
  responseVersion: { type: Number, required: true, default: 0 },
  respondedAt: Date,
  history: { type: [{ status: String, companions: [String], at: Date, version: Number }], default: [] },
}, { timestamps: true, versionKey: false })
invitationSchema.index({ eventId: 1, guestId: 1 }, { unique: true })

const uazapiConnectionSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, unique: true },
  serverUrl: { type: String, required: true },
  tokenCiphertext: { type: String, required: true, select: false },
  tokenHash: { type: String, unique: true, sparse: true },
  webhookState: String,
  webhookStateAt: Date,
  connectLeaseUntil: Date,
  sendLeaseUntil: Date,
  nextSendAt: Date,
}, { timestamps: true, versionKey: false })

const evolutionInstallationSchema = new Schema({
  _id: { type: String, default: 'global', enum: ['global'] },
  origin: { type: String, required: true },
  installationId: { type: String, required: true },
  apiKeyCiphertext: { type: String, required: true, select: false },
  verifiedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false })

const evolutionConnectionSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  installationId: { type: String, required: true },
  instanceName: { type: String, required: true, unique: true },
  channel: { type: String, required: true, enum: ['baileys', 'cloud'] },
  state: { type: String, required: true, enum: ['reserved', 'creating', 'ready', 'retiring', 'error'], default: 'reserved' },
  instanceTokenCiphertext: { type: String, required: true, select: false },
  webhookSecretCiphertext: { type: String, required: true, select: false },
  webhookSecretHash: { type: String, required: true, unique: true },
  metaTokenCiphertext: { type: String, select: false },
  metaTokenHash: String,
  phoneNumberId: String,
  businessId: String,
  webhookState: String,
  webhookStateAt: Date,
  sendLeaseUntil: Date,
  nextSendAt: Date,
  nextCampaignSendAt: Date,
  unavailableAttempts: { type: Number, default: 0 },
  unavailableUntil: Date,
  createLeaseUntil: Date,
  archivedAt: Date,
}, { timestamps: true, versionKey: false })
evolutionConnectionSchema.index({ organizationId: 1, channel: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null } })
evolutionConnectionSchema.index({ installationId: 1, instanceName: 1, organizationId: 1, channel: 1 }, { unique: true })

const evolutionTemplateSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  connectionId: { type: Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, required: true },
  name: { type: String, required: true },
  language: { type: String, required: true },
  variables: { type: [String], default: [] },
  revision: { type: Number, required: true, default: 1 },
}, { timestamps: true, versionKey: false })
evolutionTemplateSchema.index({ connectionId: 1, type: 1 }, { unique: true })

const deliveryPartSchema = new Schema({
  status: { type: String, required: true, enum: ['pending', 'sending', 'accepted', 'retry_wait', 'uncertain', 'suppressed', 'failed_permanent', 'skipped'], default: 'pending' },
  messageId: String,
  chatId: String,
  trackId: String,
  acceptedAt: Date,
  receiptStatus: String,
  receiptRank: { type: Number, default: 0 },
  receiptAt: Date,
}, { _id: false })

const deliveryAttemptSchema = new Schema({
  attemptId: { type: String, required: true },
  part: { type: String, required: true, enum: ['media', 'text'] },
  startedAt: { type: Date, required: true },
  finishedAt: Date,
  outcome: { type: String, required: true, enum: ['started', 'accepted', 'retry_wait', 'uncertain', 'suppressed', 'failed_permanent'] },
  providerCode: Number,
}, { _id: false })

const deliverySchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, index: true },
  eventId: { type: Schema.Types.ObjectId, required: true, index: true },
  invitationId: Schema.Types.ObjectId,
  guestId: Schema.Types.ObjectId,
  type: { type: String, required: true, enum: ['initial', 'automation'] },
  automationRuleId: Schema.Types.ObjectId,
  automationRevision: Number,
  automationOccurrence: String,
  automationText: String,
  scheduledAt: Date,
  graceUntil: Date,
  templateVersion: { type: Number, required: true },
  contentHash: { type: String, required: true },
  approvedMode: { type: String, required: true, enum: ['fake', 'real'] },
  approvedConnectionId: { type: Schema.Types.ObjectId, required: true },
  approvedConnectionServerUrl: { type: String, required: true },
  approvedConnectionTokenHash: { type: String, required: true },
  approvedProvider: { type: String, enum: ['uazapigo', 'evolution'] },
  approvedChannel: { type: String, enum: ['uazapi', 'baileys', 'cloud'] },
  approvedConnectionRevision: Number,
  approvedTemplateName: String,
  approvedTemplateLanguage: String,
  approvedTemplateRevision: Number,
  recipientPhone: { type: String, required: true },
  status: { type: String, required: true, enum: ['queued', 'processing', 'retry_wait', 'uncertain', 'suppressed', 'completed', 'failed_permanent'] },
  media: { type: deliveryPartSchema, required: true },
  text: { type: deliveryPartSchema, required: true },
  attempts: { type: [deliveryAttemptSchema], default: [] },
  approvedAt: { type: Date, required: true },
  leaseUntil: Date,
  nextAttemptAt: Date,
  suppressionReason: String,
  reconcileAttempts: { type: Number, default: 0 },
  nextReconcileAt: Date,
  reconcileLeaseUntil: Date,
}, { timestamps: true, versionKey: false, autoIndex: false })
deliverySchema.index({ invitationId: 1, type: 1, templateVersion: 1 },
  { unique: true, partialFilterExpression: { type: 'initial' } })
deliverySchema.index({ automationRuleId: 1, automationRevision: 1, invitationId: 1, automationOccurrence: 1 },
  { unique: true, partialFilterExpression: { type: 'automation' } })

const deliveryCampaignSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true },
  eventId: { type: Schema.Types.ObjectId, required: true },
  status: { type: String, required: true, enum: ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'], default: 'draft' },
  intervalMs: { type: Number, required: true, min: 2000, max: 3600000 },
  items: { type: [new Schema({
    invitationId: { type: Schema.Types.ObjectId, required: true },
    previewHash: { type: String, required: true },
  }, { _id: false })], required: true },
  previewHash: { type: String, required: true },
  approvedMode: { type: String, enum: ['fake', 'real'], required: true },
  approvalHash: String,
  approvedAt: Date,
  scheduledAt: Date,
  pausedAt: Date,
  cancelledAt: Date,
  cancellationReason: { type: String, enum: ['user', 'invalidated_draft'] },
  nextSendAt: Date,
}, { timestamps: true, versionKey: false })
deliveryCampaignSchema.index({ organizationId: 1, eventId: 1, createdAt: -1 })
deliveryCampaignSchema.index({ organizationId: 1, eventId: 1, previewHash: 1 }, { unique: true })
deliveryCampaignSchema.index({ status: 1, scheduledAt: 1, nextSendAt: 1 })

const webhookInboxSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, required: true, index: true },
  connectionId: { type: Schema.Types.ObjectId, required: true, index: true },
  provider: { type: String, enum: ['uazapigo', 'evolution'], default: 'uazapigo' },
  dedupKey: { type: String, required: true, unique: true },
  kind: { type: String, required: true, enum: ['connection', 'messages_update', 'messages'] },
  status: { type: String, required: true, enum: ['pending', 'processing', 'done', 'retry_wait'], default: 'pending' },
  eventId: String,
  connectionState: String,
  messageIds: [String],
  receiptState: String,
  receiptAt: Date,
  messageId: String,
  sender: String,
  chatId: String,
  fromMe: Boolean,
  isGroup: Boolean,
  text: String,
  leaseUntil: Date,
  nextAttemptAt: Date,
  processedAt: Date,
  expiresAt: { type: Date, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
}, { timestamps: true, versionKey: false })
webhookInboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 })

export const AdminModel = models.Admin || model('Admin', adminSchema)
export const SessionModel = models.Session || model('Session', sessionSchema)
export const LoginAttemptModel = models.LoginAttempt || model('LoginAttempt', loginAttemptSchema)
export const NumberVerificationModel = models.NumberVerification || model('NumberVerification', numberVerificationSchema)
export const AssistantConversationModel = models.AssistantConversation || model('AssistantConversation', assistantConversationSchema)
export const OrganizationModel = models.Organization || model('Organization', organizationSchema)
export const EventModel = models.Event || model('Event', eventSchema)
export const GuestModel = models.Guest || model('Guest', guestSchema)
export const GuestImportBatchModel = models.GuestImportBatch || model('GuestImportBatch', guestImportBatchSchema)
export const GuestImportPhoneModel = models.GuestImportPhone || model('GuestImportPhone', guestImportPhoneSchema)
export const TemplateVersionModel = models.TemplateVersion || model('TemplateVersion', templateVersionSchema)
export const InvitationModel = models.Invitation || model('Invitation', invitationSchema)
export const UazapiConnectionModel = models.UazapiConnection || model('UazapiConnection', uazapiConnectionSchema)
export const EvolutionInstallationModel = models.EvolutionInstallation || model('EvolutionInstallation', evolutionInstallationSchema)
export const EvolutionConnectionModel = models.EvolutionConnection || model('EvolutionConnection', evolutionConnectionSchema)
export const EvolutionTemplateModel = models.EvolutionTemplate || model('EvolutionTemplate', evolutionTemplateSchema)
export const DeliveryModel = models.Delivery || model('Delivery', deliverySchema)
export const DeliveryCampaignModel = models.DeliveryCampaign || model('DeliveryCampaign', deliveryCampaignSchema)
export const WebhookInboxModel = models.WebhookInbox || model('WebhookInbox', webhookInboxSchema)

export async function migrateDeliveryIndexes() {
  let indexes: Awaited<ReturnType<typeof DeliveryModel.collection.indexes>> = []
  try { indexes = await DeliveryModel.collection.indexes() }
  catch (error: unknown) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 26) throw error
  }
  const legacyName = 'invitationId_1_type_1_templateVersion_1'
  const legacy = indexes.find(index => index.name === legacyName &&
    !index.partialFilterExpression)
  if (legacy) {
    try { await DeliveryModel.collection.dropIndex(legacyName) }
    catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 27) throw error
    }
  }
  await DeliveryModel.createIndexes()
}
