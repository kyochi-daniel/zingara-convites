import { z } from 'zod'
export { guestFilePreviewInput, guestFileImportInput, type GuestFileImportInput } from './contact-import.ts'

export const loginInput = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
})

export const organizationInput = z.object({
  name: z.string().trim().min(1).max(120),
  visualIdentity: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    logoUrl: z.url().max(2048).optional(),
  }).strict().optional(),
  settings: z.object({
    replyToEmail: z.email().max(254).optional(),
  }).strict().optional(),
}).strict()

export const organizationPatch = organizationInput.partial().refine(
  value => Object.values(value).some(field => field !== undefined && (typeof field !== 'object' || Object.keys(field).length > 0)),
  'Informe ao menos um campo',
)

export type OrganizationInput = z.infer<typeof organizationInput>

const instant = z.iso.datetime({ offset: true })
const timeZone = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true }
  catch { return false }
}, 'Fuso IANA inválido')

const eventFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(500),
  startsAt: instant,
  endsAt: instant,
  rsvpDeadline: instant,
  timeZone,
  companionLimit: z.number().int().min(0).max(20),
  companionNamesRequired: z.boolean(),
}).strict()
export const eventInput = eventFields.refine(value => Date.parse(value.endsAt) > Date.parse(value.startsAt), 'Término deve seguir início')
  .refine(value => Date.parse(value.rsvpDeadline) <= Date.parse(value.startsAt), 'Prazo deve anteceder início')

export const eventPatch = eventFields.partial().strict().refine(
  value => Object.keys(value).length > 0, 'Informe ao menos um campo',
)
export const eventRevisionInput = z.object({
  expectedRevision: z.number().int().min(0),
  changes: eventFields.pick({ name: true, description: true, location: true, address: true,
    startsAt: true, endsAt: true, rsvpDeadline: true, timeZone: true }).partial().strict()
    .refine(value => Object.keys(value).length > 0, 'Informe ao menos um campo'),
}).strict()
export const eventCancelInput = z.object({ expectedRevision: z.number().int().min(0) }).strict()

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Telefone E.164 inválido')
export const evolutionNumberPreviewInput = z.object({
  phones: z.array(z.string().max(80)).min(1).max(200),
}).strict()
export const evolutionNumberVerificationInput = z.object({
  phones: z.array(e164).min(1).max(10), confirm: z.literal(true),
}).strict()
export type EvolutionNumberState = 'invalid_format' | 'not_checked' | 'unsupported' | 'registered' |
  'not_registered' | 'unavailable' | 'rate_limited'
export type EvolutionNumberIdentity = { id: string; instanceName: string; revision: number | null }
export type EvolutionNumberPreview = {
  channel: 'baileys' | 'cloud'; lookupSupported: boolean; mode: 'fake' | 'real'
  connection: EvolutionNumberIdentity
  limits: { batch: number; perMinute: number; perDay: number }
  results: { phone: string; state: EvolutionNumberState; checkedAt?: string; connection?: EvolutionNumberIdentity; cached?: boolean; retryAfterSeconds?: number }[]
}
const guestFields = z.object({
  name: z.string().trim().min(1).max(120),
  phone: e164,
  email: z.email().max(254).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  notes: z.string().max(2000),
  whatsappConsent: z.boolean(),
  authorizationSource: z.string().trim().min(5).max(300).optional(),
}).strict()
export const guestInput = z.object({ ...guestFields.shape,
  tags: guestFields.shape.tags.default([]),
  notes: guestFields.shape.notes.default(''),
  whatsappConsent: guestFields.shape.whatsappConsent.default(false),
}).strict().refine(value => !value.whatsappConsent || !!value.authorizationSource,
  { path: ['authorizationSource'], message: 'Informe a origem da autorização para WhatsApp' })
export const guestPatch = guestFields.partial().strict().refine(
  value => Object.keys(value).length > 0 && (value.whatsappConsent !== true || !!value.authorizationSource),
  'Informe a origem da autorização para WhatsApp',
)

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
}).strict()
export const guestListQuery = listQuery.safeExtend({ tag: z.string().trim().min(1).max(40).optional() })

export const csvPreviewInput = z.object({ csv: z.string().min(1).max(16_000) }).strict()
export const csvImportInput = csvPreviewInput.safeExtend({
  acceptedRows: z.array(z.number().int().min(2)).min(1).max(200),
  batchId: z.uuid(),
}).strict()

export type EventInput = z.infer<typeof eventInput>
export type GuestInput = z.infer<typeof guestInput>
export type ListQuery = z.infer<typeof listQuery>
export type GuestListQuery = z.infer<typeof guestListQuery>

export const templateVariables = [
  'convidado.nome', 'evento.nome', 'evento.data', 'evento.horario', 'evento.local',
  'evento.fuso', 'evento.prazo_confirmacao',
  'convite.link', 'convite.limite_acompanhantes',
] as const
export type TemplateVariable = typeof templateVariables[number]
const allowedVariables = new Set<string>(templateVariables)
const templateText = (max: number) => z.string().trim().min(1).max(max).refine(value =>
  !/<\s*\/?\s*[a-z][^>]*>/i.test(value) &&
  [...value].every(character => {
    const code = character.charCodeAt(0)
    return (code >= 32 && code !== 127) || [9, 10, 13].includes(code)
  }) &&
  [...value.matchAll(/\{\{([^{}]*)\}\}/g)].every(match => allowedVariables.has(match[1]?.trim() ?? '')) &&
  !value.replace(/\{\{[^{}]*\}\}/g, '').includes('{{') &&
  !value.replace(/\{\{[^{}]*\}\}/g, '').includes('}}'),
  'HTML ou variável inválida',
)
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const templateInput = z.object({
  layout: z.enum(['editorial', 'classic']),
  title: templateText(160),
  subtitle: templateText(300),
  body: templateText(3000),
  message: templateText(3000).optional(),
  primaryButtonText: templateText(80),
  secondaryButtonText: templateText(80),
  colors: z.object({ background: hexColor, text: hexColor, accent: hexColor }).strict(),
  font: z.enum(['serif', 'sans']),
  alignment: z.enum(['left', 'center']),
  blocks: z.object({ date: z.boolean(), location: z.boolean(), rsvp: z.boolean() }).strict(),
  imageAssetId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
}).strict()
export type TemplateInput = z.infer<typeof templateInput>
export const defaultEventMessageTemplate = [
  'Olá, {{convidado.nome}}!',
  'Você está convidado(a) para {{evento.nome}}.',
  '{{evento.data}} às {{evento.horario}} · {{evento.fuso}}',
  'Local: {{evento.local}}',
  'Confirme até {{evento.prazo_confirmacao}}:',
  '{{convite.link}}',
].join('\n')
export const defaultTemplate: TemplateInput = {
  layout: 'editorial', title: '{{evento.nome}}', subtitle: 'Olá, {{convidado.nome}}',
  body: 'Esperamos você em {{evento.local}}.', primaryButtonText: 'Confirmar presença',
  message: defaultEventMessageTemplate,
  secondaryButtonText: 'Ver local', colors: { background: '#FFFFFF', text: '#18212F', accent: '#A36A45' },
  font: 'serif', alignment: 'center', blocks: { date: true, location: true, rsvp: true },
}

export function resolveTemplateText(text: string, values: Partial<Record<TemplateVariable, string | number>>) {
  return text.replace(/\{\{([^{}]*)\}\}/g, (original, raw: string) => {
    const key = raw.trim()
    if (!allowedVariables.has(key)) return original
    return String(values[key as TemplateVariable] ?? `[${key} ausente]`)
  })
}

export function eventTemplateValues(event: Pick<EventInput, 'name' | 'location' | 'startsAt' | 'rsvpDeadline' | 'timeZone'>) {
  const date = new Date(event.startsAt)
  const deadline = new Date(event.rsvpDeadline)
  const day = (instant: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: event.timeZone, dateStyle: 'long' }).format(instant)
  const time = (instant: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: event.timeZone, timeStyle: 'short' }).format(instant)
  const zoneCity = ({ 'America/Campo_Grande': 'Ponta Porã', 'America/Sao_Paulo': 'Brasília',
    'Europe/Lisbon': 'Lisboa' } as Record<string, string>)[event.timeZone]
    ?? event.timeZone.split('/').at(-1)!.replaceAll('_', ' ')
  return {
    'evento.nome': event.name, 'evento.local': event.location, 'evento.data': day(date), 'evento.horario': time(date),
    'evento.fuso': `Horário de ${zoneCity}`,
    'evento.prazo_confirmacao': `${day(deadline)}, às ${time(deadline)}`,
  }
}

export function renderEventMessage(template: Pick<TemplateInput, 'message'>, values: Partial<Record<TemplateVariable, string | number>>) {
  const delimiters: Record<string, string> = { '*': '＊', '_': '＿', '~': '～', '`': '｀' }
  const literalValues = Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const text = String(value)
    if (key === 'convite.link') {
      try {
        const url = new URL(text)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /\s/.test(text)) throw new Error()
      } catch { throw new Error('Link de convite inválido') }
      return [key, text]
    }
    // Unicode counterparts keep external data from becoming provider formatting.
    const singleLine = [...text].map(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
    return [key, singleLine.replace(/[*_~`]/g, character => delimiters[character]!)]
  }))
  return resolveTemplateText(template.message ?? defaultEventMessageTemplate, literalValues)
}

export const invitationCreateInput = z.object({
  guestId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict()
export type InvitationCreateInput = z.infer<typeof invitationCreateInput>

export type EventReport = {
  eventId: string
  eventName: string
  generatedAt: string
  messages: {
    total: number
    accepted: number
    delivered: number
    read: number
    awaitingDelivery: number
    failed: number
  }
  rsvp: {
    pending: number
    accepted: number
    declined: number
    revoked: number
    peopleConfirmed: number
  }
  confirmed: Array<{
    invitationId: string
    guestId: string
    name: string
    phone: string
    peopleCount: number
  }>
}

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/)
export const assistantMessageInput = z.object({
  message: z.string().trim().min(1).max(2_000),
}).strict()

export const assistantNavigation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('area'), area: z.enum([
    'home', 'events', 'guests', 'settings', 'organizations', 'connection',
  ]) }).strict(),
  z.object({ type: z.literal('event'), area: z.enum([
    'events', 'template', 'invitations', 'deliveries', 'automations', 'campaigns',
  ]), eventId: objectId }).strict(),
])

export const assistantProposal = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_event'), organizationId: objectId, event: eventInput }).strict(),
  z.object({ action: z.literal('create_guest'), organizationId: objectId, guest: guestInput }).strict(),
  z.object({ action: z.literal('create_invitation'), organizationId: objectId,
    eventId: objectId, guestId: objectId, expiresAt: z.iso.datetime({ offset: true }).optional() }).strict(),
  z.object({ action: z.literal('create_full_invitation'), organizationId: objectId,
    event: eventInput, guest: guestInput }).strict(),
  z.object({ action: z.literal('prepare_connection'), organizationId: objectId }).strict(),
])

const assistantPending = z.object({
  intent: z.string().trim().min(1).max(80),
  fields: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
  proposal: assistantProposal.optional(),
  requestedWhatsAppSend: z.boolean().optional(),
}).strict()

export const assistantDecision = z.discriminatedUnion('action', [
  z.object({ action: z.literal('respond'), reply: z.string().trim().min(1).max(1_500), pending: assistantPending.optional() }).strict(),
  z.object({ action: z.literal('navigate'), organizationId: objectId, navigation: assistantNavigation,
    reply: z.string().trim().min(1).max(1_500) }).strict(),
  z.object({ action: z.literal('connection_status'), organizationId: objectId }).strict(),
  z.object({ action: z.literal('create_event'), organizationId: objectId, event: eventInput }).strict(),
  z.object({ action: z.literal('create_guest'), organizationId: objectId, guest: guestInput }).strict(),
  z.object({ action: z.literal('create_invitation'), organizationId: objectId,
    eventId: objectId, guestId: objectId, expiresAt: z.iso.datetime({ offset: true }).optional() }).strict(),
  z.object({ action: z.literal('create_full_invitation'), organizationId: objectId,
    event: eventInput, guest: guestInput }).strict(),
  z.object({ action: z.literal('prepare_connection'), organizationId: objectId }).strict(),
])

export type AssistantMessageInput = z.infer<typeof assistantMessageInput>
export type AssistantNavigation = z.infer<typeof assistantNavigation>
export type AssistantDecision = z.infer<typeof assistantDecision>
export type AssistantProposal = z.infer<typeof assistantProposal>

const assistantModelEvent = z.object({
  name: z.string(), description: z.string().nullable(), location: z.string(), address: z.string(),
  startsAt: z.string(), endsAt: z.string(), rsvpDeadline: z.string(), timeZone: z.string(),
  companionLimit: z.number(), companionNamesRequired: z.boolean(),
}).strict()
const assistantModelGuest = z.object({
  name: z.string(), phone: z.string(), email: z.string().nullable(), tags: z.array(z.string()),
  notes: z.string(), whatsappConsent: z.boolean(), authorizationSource: z.string().nullable(),
}).strict()
const assistantModelNavigation = z.object({
  type: z.enum(['area', 'event']), area: z.enum([
    'home', 'events', 'guests', 'settings', 'organizations', 'connection',
    'template', 'invitations', 'deliveries', 'automations', 'campaigns',
  ]), eventId: z.string().nullable(),
}).strict()
export const assistantModelDecision = z.object({
  action: z.enum(['respond', 'navigate', 'connection_status', 'create_event', 'create_guest',
    'create_invitation', 'create_full_invitation', 'prepare_connection']),
  organizationId: z.string().nullable(),
  reply: z.string().nullable(),
  navigation: assistantModelNavigation.nullable(),
  event: assistantModelEvent.nullable(),
  guest: assistantModelGuest.nullable(),
  eventId: z.string().nullable(),
  guestId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  pending: z.object({ intent: z.string(), fields: z.array(z.object({ name: z.string(), value: z.string() }).strict()) }).strict().nullable(),
}).strict()
export const assistantModelDecisionJsonSchema = z.toJSONSchema(assistantModelDecision)

export function sanitizeAssistantText(value: string) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, '[QR removido]')
    .replace(/(?:https?:\/\/[^\s]+)?\/i\/[A-Za-z0-9_-]{40,}(?:[^\s]*)?/gi, '[link do convite removido]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi, 'Bearer [removido]')
    .replace(/\b(token|api[ _-]?key|chave(?: da)? api|senha|qr(?: code)?)\b([ \t]*(?::|=|é|e)[ \t]*)[^\r\n]+/gi, '$1$2[removido]')
    .replace(/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{40,}(?![A-Za-z0-9+/=_-])/g, '[dado longo removido]')
    .slice(0, 2_000)
}

function sanitizeAssistantProposal(value: unknown) {
  const parsed = assistantProposal.safeParse(value)
  if (!parsed.success) return undefined
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return sanitizeAssistantText(item)
    if (Array.isArray(item)) return item.map(visit)
    if (item && typeof item === 'object') return Object.fromEntries(
      Object.entries(item).map(([key, field]) => [key, visit(field)]),
    )
    return item
  }
  const safe = assistantProposal.safeParse(visit(parsed.data))
  return safe.success ? safe.data : undefined
}

export function sanitizeAssistantPending(value: unknown) {
  const parsed = assistantPending.safeParse(value)
  if (!parsed.success) return undefined
  const sensitive = /token|api.?key|chave|senha|password|qr|link/i
  const fields = Object.fromEntries(Object.entries(parsed.data.fields ?? {})
    .filter(([key]) => !sensitive.test(key))
    .map(([key, field]) => [key, typeof field === 'string' ? sanitizeAssistantText(field) : field]))
  const proposal = sanitizeAssistantProposal(parsed.data.proposal)
  return {
    intent: sanitizeAssistantText(parsed.data.intent).slice(0, 80),
    ...(Object.keys(fields).length ? { fields } : {}),
    ...(proposal ? { proposal } : {}),
    ...(parsed.data.requestedWhatsAppSend === undefined ? {} : {
      requestedWhatsAppSend: parsed.data.requestedWhatsAppSend,
    }),
  }
}

export const rsvpInput = z.object({
  status: z.enum(['accepted', 'declined']),
  companions: z.array(z.string().trim().max(80)).max(20),
  expectedVersion: z.number().int().min(0),
}).strict().refine(value => value.status !== 'declined' || value.companions.length === 0, 'Recusa não aceita acompanhantes')
export type RsvpInput = z.infer<typeof rsvpInput>

export const evolutionConnectionInput = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('baileys') }).strict(),
  z.object({ channel: z.literal('cloud'), metaToken: z.string().trim().min(16).max(4096),
    phoneNumberId: z.string().regex(/^\d{5,30}$/), businessId: z.string().regex(/^\d{5,30}$/) }).strict(),
])
export type EvolutionConnectionInput = z.infer<typeof evolutionConnectionInput>

export const evolutionInstallationInput = z.object({
  baseUrl: z.string().min(1).max(2048),
  adminApiKey: z.string().min(1).max(4096).refine(value => !/[\r\n]/.test(value)),
}).strict()
export type EvolutionInstallationInput = z.infer<typeof evolutionInstallationInput>

const existingInstanceName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
const existingInstanceToken = z.string().min(1).max(4096).refine(value => !/[\r\n]/.test(value))
export const evolutionBindInput = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('baileys'), instanceName: existingInstanceName,
    token: existingInstanceToken, confirm: z.literal(true) }).strict(),
  z.object({ channel: z.literal('cloud'), instanceName: existingInstanceName,
    token: existingInstanceToken, phoneNumberId: z.string().regex(/^\d{5,30}$/),
    businessId: z.string().regex(/^\d{5,30}$/), confirm: z.literal(true) }).strict(),
])
export type EvolutionBindInput = z.infer<typeof evolutionBindInput>

export const activeConnectionInput = z.object({ provider: z.literal('evolution'),
  connectionId: z.string().regex(/^[a-f0-9]{24}$/i), revision: z.number().int().min(0) }).strict()

export const officialTemplateInput = z.object({
  type: z.enum(['initial', 'pending_reminder', 'confirmation', 'receipt', 'event_change', 'event_cancellation', 'admin_summary']),
  name: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-z]{2,3}_[A-Z]{2}$/),
  variables: z.array(z.enum(['convidado.nome', 'evento.nome', 'evento.data', 'evento.horario', 'evento.local',
    'convite.link', 'convite.limite_acompanhantes'])).max(10).optional(),
}).strict()

export const deliveryApprovalInput = z.object({
  invitationId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  approve: z.literal(true),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
export type DeliveryApprovalInput = z.infer<typeof deliveryApprovalInput>

const campaignInvitationIds = z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(200)
  .refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'Convites duplicados')
export const deliveryCampaignPlanInput = z.object({
  invitationIds: campaignInvitationIds,
  intervalMs: z.number().int().min(2_000).max(3_600_000).default(5_000),
  scheduledAt: instant.nullable().optional(),
}).strict()
export const deliveryCampaignApprovalInput = z.object({
  approve: z.literal(true),
  previewHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()
export const deliveryCampaignActionInput = z.object({}).strict()
export type DeliveryCampaignPlanInput = z.infer<typeof deliveryCampaignPlanInput>
export type DeliveryCampaignApprovalInput = z.infer<typeof deliveryCampaignApprovalInput>
export type DeliveryCampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'
