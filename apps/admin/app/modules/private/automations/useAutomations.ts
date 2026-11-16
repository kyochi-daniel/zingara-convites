import type { Guest } from '~/modules/private/guests/useGuests'
import type { EventItem } from '~/modules/private/events/useEvents'
import {
  automationAnchorLabel,
  automationAudienceLabel,
  automationDefault,
  automationJobStatusLabel,
  automationJobTypeLabel,
  automationResponseLabel,
  automationSampleReason,
  automationTextTokens as tokensForAutomationType,
  automationTypeLabel,
  automationTypeOptions,
  validFixedSchedule,
  type AutomationAnchor,
  type AutomationAudience,
  type AutomationJob,
  type AutomationPreview,
  type AutomationRule,
  type AutomationType,
} from './domain'

type RefLike<T> = { value: T }
type EvolutionStatus = { state: string; mode?: 'fake' | 'real'; qrCode?: string }
type ActiveConnection = { provider: 'evolution'; channel: 'baileys' | 'cloud'; connectionId: string; revision: number } | null

export function useAutomations(dependencies: {
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
  activeArea: RefLike<string>
}) {
  const automationEvent = ref<EventItem | null>(null)
  const automationRules = ref<AutomationRule[]>([])
  const automationType = ref<AutomationType>('pending_reminder')
  const automationForm = reactive({
    enabled: false,
    audience: 'pending' as AutomationAudience,
    anchor: 'rsvp_deadline' as AutomationAnchor,
    offsetMinutes: 0,
    at: '',
    text: '',
    maxExecutions: 1,
    graceMinutes: 60,
  })
  const automationSavedSnapshot = ref('')
  const automationPreview = ref<AutomationPreview | null>(null)
  const automationPreviewRevision = ref<number | null>(null)
  const automationJobs = ref<AutomationJob[]>([])
  const automationGuests = ref<Guest[]>([])
  const automationGuestQuery = ref('')
  const automationGuestId = ref('')
  const automationSuppressionReason = ref('')
  const automationSuppressionConfirmed = ref(false)
  const automationMode = ref<'fake' | 'real' | null>(null)
  const automationLoading = ref(false)
  const automationSaving = ref(false)
  const automationPreviewLoading = ref(false)
  const automationActivating = ref(false)
  const automationSuppressing = ref(false)
  const automationError = ref('')
  const automationNotice = ref('')

  const csrfHeaders = computed(() => ({ 'x-csrf-token': dependencies.csrfToken.value }))
  const selectedAutomationType = computed(() => automationTypeOptions.find(item => item.value === automationType.value)!)
  const automationFormDirty = computed(() => JSON.stringify(automationForm) !== automationSavedSnapshot.value)
  const automationRule = computed(() => automationRules.value.find(item => item.type === automationType.value))
  const automationRuleActive = computed(() => Boolean(automationRule.value?.enabled && automationRule.value.activatedRevision === automationRule.value.revision))
  const automationAvailableAudiences = computed(() => selectedAutomationType.value.audiences)
  const automationAvailableAnchors = computed(() => selectedAutomationType.value.anchors)
  const automationUsesFixedTime = computed(() => automationForm.anchor === 'fixed')
  const automationTextTokens = computed(() => tokensForAutomationType(automationType.value))

  const organizationPath = (resource: string) => `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/${resource}`
  const evolutionPath = (resource = '') => organizationPath(`connections/evolution${resource ? `/${resource}` : ''}`)
  const automationCollectionPath = (eventId = automationEvent.value?.id ?? '') => organizationPath(`events/${encodeURIComponent(eventId)}/automations`)
  const automationPath = (suffix = '') => `${automationCollectionPath()}${suffix}`

  function statusCodeOf(value: unknown) {
    return typeof value === 'object' && value && 'statusCode' in value ? Number(value.statusCode) : undefined
  }

  function setAutomationType(type: AutomationType) {
    automationType.value = type
    automationPreview.value = null
    automationPreviewRevision.value = null
    const rule = automationRules.value.find(item => item.type === type)
    Object.assign(automationForm, rule ? {
      enabled: rule.enabled,
      audience: rule.audience,
      anchor: rule.schedule.anchor,
      offsetMinutes: rule.schedule.offsetMinutes,
      at: rule.schedule.at ?? '',
      text: rule.text,
      maxExecutions: rule.maxExecutions,
      graceMinutes: rule.graceMinutes,
    } : automationDefault(type))
    automationSavedSnapshot.value = JSON.stringify(automationForm)
  }

  function replaceAutomationRule(rule: AutomationRule) {
    automationRules.value = [...automationRules.value.filter(item => item.type !== rule.type), rule]
  }

  function resetAutomations() {
    automationEvent.value = null
    automationRules.value = []
    automationJobs.value = []
    automationPreview.value = null
    automationPreviewRevision.value = null
    automationGuests.value = []
    automationGuestId.value = ''
    automationGuestQuery.value = ''
    automationSuppressionReason.value = ''
    automationSuppressionConfirmed.value = false
    automationMode.value = null
    automationError.value = ''
    automationNotice.value = ''
  }

  async function loadAutomationData() {
    if (!automationEvent.value) return
    automationLoading.value = true
    automationError.value = ''
    try {
      const [rulesResult, jobsResult] = await Promise.all([
        $fetch<{ rules: AutomationRule[] }>(automationCollectionPath()),
        $fetch<{ items: AutomationJob[] }>(automationPath('/jobs'), { query: { limit: 50 } }),
      ])
      automationRules.value = rulesResult.rules
      automationJobs.value = jobsResult.items
      setAutomationType(automationType.value)
    } catch {
      automationError.value = 'Não foi possível carregar regras e histórico. Atualize a tela e tente novamente.'
    } finally { automationLoading.value = false }
    try {
      const selection = await $fetch<{ active: ActiveConnection }>(organizationPath('connections/active'))
      const status = selection.active && await $fetch<{ status: EvolutionStatus }>(evolutionPath(`${selection.active.connectionId}/status`))
      automationMode.value = status?.status.mode ?? null
    } catch { automationMode.value = null }
  }

  async function openAutomationPanel(event: EventItem) {
    resetAutomations()
    automationEvent.value = event
    dependencies.activeArea.value = 'automations'
    await loadAutomationData()
  }

  async function saveAutomationRule() {
    if (!automationEvent.value || automationSaving.value) return
    automationError.value = ''
    automationNotice.value = ''
    automationPreview.value = null
    automationPreviewRevision.value = null
    if (!automationForm.text.trim() || automationForm.text.trim().length > 1000) {
      automationError.value = 'O texto precisa ter entre 1 e 1.000 caracteres.'
      return
    }
    if (automationUsesFixedTime.value && !validFixedSchedule(automationForm.at)) {
      automationError.value = 'Informe data e hora ISO 8601 com offset explícito, por exemplo 2026-11-12T18:30:00-04:00.'
      return
    }
    automationSaving.value = true
    const current = automationRule.value
    try {
      const result = await $fetch<{ rule: AutomationRule }>(automationPath(`/${automationType.value}`), {
        method: 'PUT', headers: csrfHeaders.value,
        body: {
          enabled: automationForm.enabled,
          audience: automationForm.audience,
          schedule: {
            anchor: automationForm.anchor,
            offsetMinutes: Number(automationForm.offsetMinutes),
            ...(automationUsesFixedTime.value ? { at: automationForm.at.trim() } : {}),
          },
          text: automationForm.text.trim(),
          maxExecutions: Number(automationForm.maxExecutions),
          graceMinutes: Number(automationForm.graceMinutes),
          expectedRevision: current?.revision ?? 0,
        },
      })
      replaceAutomationRule(result.rule)
      setAutomationType(result.rule.type)
      automationNotice.value = result.rule.activatedRevision === result.rule.revision && result.rule.enabled
        ? 'Regra salva e ativa nesta revisão.'
        : 'Regra salva como rascunho. Gere uma prévia para revisar e ativar esta revisão.'
    } catch (problem: unknown) {
      automationError.value = statusCodeOf(problem) === 409
        ? 'A regra mudou em outra sessão. Atualize a lista antes de salvar.'
        : 'Não foi possível salvar a regra. Confira os limites e tente novamente.'
    } finally { automationSaving.value = false }
  }

  async function previewAutomation() {
    if (!automationEvent.value || automationFormDirty.value || automationPreviewLoading.value) return
    automationError.value = ''
    automationNotice.value = ''
    automationPreview.value = null
    automationPreviewRevision.value = null
    automationPreviewLoading.value = true
    try {
      const result = await $fetch<{ preview: AutomationPreview }>(automationPath(`/${automationType.value}/preview`))
      automationPreview.value = result.preview
      automationPreviewRevision.value = automationRule.value?.revision ?? null
    } catch (problem: unknown) {
      automationError.value = statusCodeOf(problem) === 409
        ? 'A revisão mudou ou esta regra não está elegível. Salve novamente e gere outra prévia.'
        : automationType.value === 'admin_summary'
          ? 'Não foi possível gerar a prévia. Confira se o número administrativo está configurado.'
          : 'Não foi possível calcular os destinatários. Atualize regras e conexão.'
    } finally { automationPreviewLoading.value = false }
  }

  async function activateAutomation() {
    const rule = automationRule.value
    const preview = automationPreview.value
    if (!rule || !preview || automationMode.value !== 'fake' || automationFormDirty.value || automationPreviewRevision.value !== rule.revision || automationActivating.value) return
    automationActivating.value = true
    automationError.value = ''
    automationNotice.value = ''
    try {
      const result = await $fetch<{ rule: AutomationRule; planned: number }>(automationPath(`/${automationType.value}/activate`), {
        method: 'POST', headers: csrfHeaders.value, body: { expectedRevision: rule.revision, previewHash: preview.previewHash },
      })
      replaceAutomationRule(result.rule)
      automationPreview.value = null
      automationPreviewRevision.value = null
      setAutomationType(result.rule.type)
      automationNotice.value = `Regra ativada. ${result.planned} tarefa(s) planejada(s); isso não confirma aceitação ou entrega.`
      await loadAutomationJobs()
    } catch (problem: unknown) {
      automationError.value = statusCodeOf(problem) === 409
        ? 'A prévia venceu ou a regra mudou. Revise novamente antes de ativar.'
        : 'Não foi possível ativar a regra. Gere uma nova prévia e tente novamente.'
      automationPreview.value = null
      automationPreviewRevision.value = null
    } finally { automationActivating.value = false }
  }

  async function loadAutomationJobs() {
    if (!automationEvent.value) return
    try {
      automationJobs.value = (await $fetch<{ items: AutomationJob[] }>(automationPath('/jobs'), { query: { limit: 50 } })).items
    } catch { automationError.value = 'Não foi possível atualizar o histórico de tarefas.' }
  }

  async function searchAutomationGuests() {
    if (!automationGuestQuery.value.trim()) {
      automationError.value = 'Digite nome ou telefone para buscar contato.'
      return
    }
    automationError.value = ''
    try {
      const result = await $fetch<{ items: Guest[] }>(organizationPath('guests'), { query: { page: 1, limit: 100, q: automationGuestQuery.value.trim() } })
      automationGuests.value = result.items
      automationGuestId.value = result.items[0]?.id ?? ''
      if (!result.items.length) automationError.value = 'Nenhum contato encontrado para esta busca.'
    } catch { automationError.value = 'Não foi possível buscar contatos para supressão manual.' }
  }

  async function suppressAutomationGuest() {
    if (!automationEvent.value || !automationGuestId.value || !automationSuppressionReason.value.trim() || !automationSuppressionConfirmed.value || automationSuppressing.value) return
    automationSuppressing.value = true
    automationError.value = ''
    automationNotice.value = ''
    try {
      await $fetch<{ guestId: string; suppressed: true }>(automationPath(`/guests/${encodeURIComponent(automationGuestId.value)}/suppress`), {
        method: 'POST', headers: csrfHeaders.value, body: { reason: automationSuppressionReason.value.trim() },
      })
      const guest = automationGuests.value.find(item => item.id === automationGuestId.value)
      automationNotice.value = `Supressão registrada para ${guest?.name ?? 'o contato'}. Novas notificações ficarão bloqueadas até revisão autorizada.`
      automationSuppressionConfirmed.value = false
      automationSuppressionReason.value = ''
      await loadAutomationJobs()
    } catch { automationError.value = 'Não foi possível registrar a supressão. Atualize o estado do contato e tente novamente.' }
    finally { automationSuppressing.value = false }
  }

  function closeAutomationPanel() {
    automationEvent.value = null
    automationPreview.value = null
    automationPreviewRevision.value = null
    dependencies.activeArea.value = 'events'
  }

  return {
    automationEvent, automationRules, automationType, automationForm, automationSavedSnapshot,
    automationPreview, automationPreviewRevision, automationJobs, automationGuests, automationGuestQuery,
    automationGuestId, automationSuppressionReason, automationSuppressionConfirmed, automationMode,
    automationLoading, automationSaving, automationPreviewLoading, automationActivating,
    automationSuppressing, automationError, automationNotice, selectedAutomationType,
    automationFormDirty, automationRule, automationRuleActive, automationAvailableAudiences,
    automationAvailableAnchors, automationUsesFixedTime, automationTextTokens, automationTypeOptions,
    automationTypeLabel, automationAudienceLabel, automationAnchorLabel, automationResponseLabel,
    automationJobStatusLabel, automationJobTypeLabel, automationSampleReason, setAutomationType,
    resetAutomations, loadAutomationData, openAutomationPanel, saveAutomationRule,
    previewAutomation, activateAutomation, loadAutomationJobs, searchAutomationGuests,
    suppressAutomationGuest, closeAutomationPanel,
  }
}
