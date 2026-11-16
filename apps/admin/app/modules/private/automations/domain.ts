export type AutomationType = 'initial' | 'pending_reminder' | 'confirmation' | 'receipt' | 'event_change' | 'event_cancellation' | 'admin_summary'
export type AutomationAudience = 'all' | 'pending' | 'accepted' | 'declined' | 'admin'
export type AutomationAnchor = 'activation' | 'event_start' | 'rsvp_deadline' | 'rsvp_update' | 'event_update' | 'event_cancelled' | 'fixed'
export type AutomationRule = {
  id: string
  type: AutomationType
  enabled: boolean
  audience: AutomationAudience
  schedule: { anchor: AutomationAnchor; offsetMinutes: number; at?: string }
  text: string
  maxExecutions: number
  graceMinutes: number
  revision: number
  activatedRevision: number | null
  updatedAt: string
}
export type AutomationSample = {
  invitationId: string
  guestName: string
  phone: string
  responseStatus: string
  scheduledAt: string
  eligible: boolean
  reason?: string
}
export type AutomationPreview = {
  recipientCount: number
  sample: AutomationSample[]
  previewHash: string
  deliveryContent:
    | { kind: 'official_template'; name: string; language: string; textUsed: false }
    | { kind: 'free_text'; textUsed: true }
}
export type AutomationJob = {
  id: string
  type: string
  ruleType?: AutomationType
  invitationId?: string
  guestName?: string
  recipientPhone: string
  status: string
  scheduledAt: string
  suppressionReason?: string
  updatedAt: string
}

export const automationTypeOptions: Array<{
  value: AutomationType
  label: string
  audiences: AutomationAudience[]
  anchors: AutomationAnchor[]
}> = [
  { value: 'initial', label: 'Convite inicial', audiences: ['pending'], anchors: ['activation', 'fixed'] },
  { value: 'pending_reminder', label: 'Cobrança de pendentes', audiences: ['pending'], anchors: ['rsvp_deadline', 'fixed'] },
  { value: 'confirmation', label: 'Lembrete de confirmados', audiences: ['accepted'], anchors: ['event_start', 'fixed'] },
  { value: 'receipt', label: 'Comprovante opcional', audiences: ['accepted'], anchors: ['rsvp_update'] },
  { value: 'event_change', label: 'Aviso de alteração', audiences: ['all', 'pending', 'accepted', 'declined'], anchors: ['event_update'] },
  { value: 'event_cancellation', label: 'Cancelamento do evento', audiences: ['all', 'pending', 'accepted', 'declined'], anchors: ['event_cancelled'] },
  { value: 'admin_summary', label: 'Resumo administrativo', audiences: ['admin'], anchors: ['event_start', 'fixed'] },
]

export function automationTypeLabel(type: AutomationType) {
  return automationTypeOptions.find(item => item.value === type)?.label ?? type
}

export function automationJobTypeLabel(job: AutomationJob) {
  return job.ruleType ? automationTypeLabel(job.ruleType) : 'Automação'
}

export function automationAudienceLabel(audience: AutomationAudience) {
  return ({ all: 'Todos os convidados', pending: 'Convites pendentes', accepted: 'Confirmados', declined: 'Recusados', admin: 'Administradores' } as Record<AutomationAudience, string>)[audience]
}

export function automationAnchorLabel(anchor: AutomationAnchor) {
  return ({ activation: 'Ativação da regra', event_start: 'Início do evento', rsvp_deadline: 'Prazo de confirmação', rsvp_update: 'Resposta ao convite', event_update: 'Alteração do evento', event_cancelled: 'Cancelamento do evento', fixed: 'Data e hora definidas' } as Record<AutomationAnchor, string>)[anchor]
}

export function automationResponseLabel(response: string) {
  return ({ pending: 'Pendente', accepted: 'Confirmado', declined: 'Recusado', admin: 'Administrador' } as Record<string, string>)[response] ?? response
}

export function automationJobStatusLabel(status: string) {
  return ({ planned: 'Planejado', queued: 'Planejado', processing: 'Em processamento', retry_wait: 'Aguardando nova tentativa', accepted: 'Aceito pelo provedor', completed: 'Aceito pelo provedor', uncertain: 'Incerto', suppressed: 'Suprimido', failed: 'Falha', failed_permanent: 'Falha permanente' } as Record<string, string>)[status] ?? status
}

export function automationSampleReason(reason: string) {
  return ({ already_responded: 'O convite já foi respondido', expired: 'O convite expirou', revoked: 'O convite foi revogado', invitation_inactive: 'O convite expirou ou foi revogado', opted_out: 'O contato pediu para não receber mensagens', opt_out: 'O contato pediu para não receber mensagens', no_consent: 'O contato não autorizou WhatsApp', event_cancelled: 'O evento foi cancelado', outside_window: 'Fora da janela de envio', missing_connection: 'Conexão indisponível', no_connection: 'Conexão indisponível', max_executions: 'Limite de execuções atingido', rsvp_changed: 'A resposta RSVP mudou', trigger_pending: 'O horário ainda não foi definido', deadline_passed: 'O prazo de confirmação passou', admin_not_configured: 'Número administrativo não configurado', guest_missing: 'Contato não encontrado' } as Record<string, string>)[reason] ?? reason
}

export function automationDefault(type: AutomationType) {
  const option = automationTypeOptions.find(item => item.value === type)!
  const anchors: Partial<Record<AutomationType, AutomationAnchor>> = {
    initial: 'activation',
    pending_reminder: 'rsvp_deadline',
    confirmation: 'event_start',
    receipt: 'rsvp_update',
    event_change: 'event_update',
    event_cancellation: 'event_cancelled',
    admin_summary: 'event_start',
  }
  const messages: Record<AutomationType, string> = {
    initial: 'Olá! Seu convite está disponível. Consulte o link individual enviado pela organização.',
    pending_reminder: 'Olá! Este é um lembrete sobre seu convite. Se já respondeu, desconsidere esta mensagem.',
    confirmation: 'Olá! Estamos felizes com sua confirmação. Esperamos você no evento.',
    receipt: 'Olá! Registramos sua resposta ao convite. Obrigado!',
    event_change: 'Olá! As informações do evento foram atualizadas. Consulte seu convite para ver os detalhes.',
    event_cancellation: 'Olá! O evento foi cancelado. Entre em contato com a organização se precisar de ajuda.',
    admin_summary: 'Resumo de confirmações do evento.',
  }
  return {
    enabled: false,
    audience: option.audiences[0]!,
    anchor: anchors[type] ?? option.anchors[0]!,
    offsetMinutes: 0,
    at: '',
    text: messages[type],
    maxExecutions: 1,
    graceMinutes: 60,
  }
}

export function validFixedSchedule(value: string) {
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/
  return pattern.test(value) && Number.isFinite(Date.parse(value))
}

export function automationTextTokens(type: AutomationType) {
  const common = ['{{convidado.nome}}', '{{evento.nome}}', '{{evento.data}}', '{{evento.horario}}', '{{evento.local}}', '{{convite.link}}', '{{convite.limite_acompanhantes}}']
  return type === 'admin_summary'
    ? [...common, '{{resumo.pendentes}}', '{{resumo.confirmados}}', '{{resumo.recusados}}']
    : common
}
