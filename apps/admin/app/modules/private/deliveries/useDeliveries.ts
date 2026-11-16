import type { TemplateInput, TemplateVariable } from '@zingara/contracts'
import type { Invitation } from '~/modules/private/invitations/useInvitations'

type RefLike<T> = { value: T }

export type DeliveryEvent = {
  id: string
  name: string
  rsvpDeadline: string
  timeZone: string
  publishedTemplateVersion?: number
}

export type DeliveryStatus = 'queued' | 'processing' | 'retry_wait' | 'uncertain' | 'suppressed' | 'completed' | 'failed_permanent'
export type DeliveryPartStatus = 'pending' | 'accepted' | 'retry_wait' | 'uncertain' | 'suppressed' | 'failed_permanent'
export type DeliveryPart = { status: DeliveryPartStatus; messageId?: string }
export type DeliveryAttempt = { part: 'media' | 'text'; outcome: string; startedAt: string; finishedAt?: string; providerCode?: number }
export type Delivery = {
  id: string
  invitationId: string
  guestName: string
  status: DeliveryStatus
  media: DeliveryPart
  text: DeliveryPart
  attempts: DeliveryAttempt[]
  createdAt: string
  updatedAt: string
}
export type DeliveryPreview = {
  recipient: { name: string; phone: string; whatsappConsent: boolean }
  text: string
  link: string
  template: TemplateInput
  renderData: Partial<Record<TemplateVariable, string | number>>
  mode: 'fake' | 'real'
  previewHash: string
}

function statusCodeOf(value: unknown) {
  return typeof value === 'object' && value && 'statusCode' in value ? Number(value.statusCode) : undefined
}

export function useDeliveries(dependencies: {
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
  activeArea: RefLike<string>
}) {
  const deliveryEvent = ref<DeliveryEvent | null>(null)
  const deliveryInvitations = ref<Invitation[]>([])
  const deliveryInvitationId = ref('')
  const deliveryRows = ref<Delivery[]>([])
  const deliveryPreview = ref<DeliveryPreview | null>(null)
  const deliveryPreviewInvitationId = ref('')
  const deliveryLoading = ref(false)
  const deliveryPreviewLoading = ref(false)
  const deliveryApproving = ref(false)
  const deliveryApprovalConfirmed = ref(false)
  const deliveryError = ref('')
  const deliveryNotice = ref('')

  const eligibleDeliveryInvitations = computed(() => deliveryInvitations.value.filter(item =>
    !item.revokedAt && item.responseStatus === 'pending' && new Date(item.expiresAt).getTime() > Date.now(),
  ))
  const selectedDeliveryInvitation = computed(() => eligibleDeliveryInvitations.value.find(item => item.id === deliveryInvitationId.value))
  const selectedInvitationHasDelivery = computed(() => deliveryRows.value.some(item => item.invitationId === deliveryInvitationId.value))
  const deliveryPreviewValues = computed(() => deliveryPreview.value?.renderData ?? {})
  const deliveryPreviewImageUrl = computed(() => {
    const imageAssetId = deliveryPreview.value?.template.imageAssetId
    return imageAssetId ? `/media/${imageAssetId}` : ''
  })
  const deliveryPreviewDateLabel = computed(() => {
    const date = deliveryPreviewValues.value['evento.data']
    const time = deliveryPreviewValues.value['evento.horario']
    return [date, time].filter(Boolean).join(' às ')
  })
  const deliveryPreviewDeadlineLabel = computed(() => deliveryEvent.value
    ? new Date(deliveryEvent.value.rsvpDeadline).toLocaleString('pt-BR', { timeZone: deliveryEvent.value.timeZone })
    : '')

  function organizationPath(resource: string) {
    return `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/${resource}`
  }

  function invitationCollectionPath(eventId = deliveryEvent.value?.id ?? '') {
    return organizationPath(`events/${encodeURIComponent(eventId)}/invitations`)
  }

  function deliveryCollectionPath(eventId = deliveryEvent.value?.id ?? '') {
    return organizationPath(`events/${encodeURIComponent(eventId)}/deliveries`)
  }

  function clearDeliveryPreview() {
    deliveryPreview.value = null
    deliveryPreviewInvitationId.value = ''
    deliveryApprovalConfirmed.value = false
  }

  function resetDeliveries() {
    deliveryEvent.value = null
    deliveryInvitations.value = []
    deliveryInvitationId.value = ''
    deliveryRows.value = []
    clearDeliveryPreview()
  }

  async function loadDeliveryData() {
    if (!deliveryEvent.value) return
    deliveryLoading.value = true
    deliveryError.value = ''
    try {
      const [invitationResult, deliveryResult] = await Promise.all([
        $fetch<{ items: Invitation[] }>(invitationCollectionPath(deliveryEvent.value.id)),
        $fetch<{ items: Delivery[] }>(deliveryCollectionPath()),
      ])
      deliveryInvitations.value = invitationResult.items
      deliveryRows.value = deliveryResult.items
      if (!eligibleDeliveryInvitations.value.some(item => item.id === deliveryInvitationId.value)) {
        deliveryInvitationId.value = eligibleDeliveryInvitations.value[0]?.id ?? ''
        clearDeliveryPreview()
      }
    } catch {
      deliveryError.value = 'Não foi possível carregar convites elegíveis e tentativas deste evento.'
    } finally {
      deliveryLoading.value = false
    }
  }

  async function openDeliveryPanel(event: DeliveryEvent) {
    resetDeliveries()
    deliveryEvent.value = event
    deliveryError.value = ''
    deliveryNotice.value = ''
    dependencies.activeArea.value = 'deliveries'
    if (!event.publishedTemplateVersion) {
      deliveryError.value = 'Publique o convite do evento antes de revisar um envio.'
      return
    }
    await loadDeliveryData()
  }

  async function loadDeliveryPreview() {
    if (!deliveryEvent.value || !deliveryInvitationId.value || deliveryPreviewLoading.value) return
    deliveryPreviewLoading.value = true
    deliveryError.value = ''
    deliveryNotice.value = ''
    clearDeliveryPreview()
    try {
      const result = await $fetch<{ preview: DeliveryPreview }>(`${deliveryCollectionPath()}/preview`, {
        query: { invitationId: deliveryInvitationId.value },
      })
      deliveryPreview.value = result.preview
      deliveryPreviewInvitationId.value = deliveryInvitationId.value
    } catch (problem: unknown) {
      deliveryError.value = statusCodeOf(problem) === 409
        ? 'Este convite não está elegível ou mudou desde a seleção. Atualize a lista e revise novamente.'
        : 'Não foi possível gerar a prévia. Atualize convites e tente de novo.'
      await loadDeliveryData()
    } finally {
      deliveryPreviewLoading.value = false
    }
  }

  async function approveFakeDelivery() {
    const preview = deliveryPreview.value
    if (!preview || deliveryPreviewInvitationId.value !== deliveryInvitationId.value || preview.mode !== 'fake' || !preview.recipient.whatsappConsent || !deliveryApprovalConfirmed.value || deliveryApproving.value) return
    deliveryApproving.value = true
    deliveryError.value = ''
    deliveryNotice.value = ''
    try {
      await $fetch<{ delivery: Delivery }>(deliveryCollectionPath(), {
        method: 'POST',
        headers: { 'x-csrf-token': dependencies.csrfToken.value },
        body: { invitationId: deliveryPreviewInvitationId.value, approve: true, previewHash: preview.previewHash },
      })
      clearDeliveryPreview()
      deliveryNotice.value = 'Aprovação simulada registrada. O worker ainda processará as partes; aceitação do provedor não confirma entrega.'
      await loadDeliveryData()
    } catch (problem: unknown) {
      deliveryError.value = statusCodeOf(problem) === 409
        ? 'O consentimento ou conteúdo mudou desde a prévia. Revise os dados e gere uma prévia nova.'
        : 'Não foi possível registrar a aprovação simulada.'
      clearDeliveryPreview()
      await loadDeliveryData()
    } finally {
      deliveryApproving.value = false
    }
  }

  function closeDeliveryPanel() {
    clearDeliveryPreview()
    dependencies.activeArea.value = 'events'
  }

  function deliveryStatusLabel(status: DeliveryStatus) {
    return ({ queued: 'Planejado', processing: 'Em processamento', retry_wait: 'Aguardando tentativa', uncertain: 'Incerto — reconciliar', suppressed: 'Suprimido', completed: 'Aceito pelo provedor', failed_permanent: 'Falha permanente' } as Record<DeliveryStatus, string>)[status]
  }

  function deliveryPartStatusLabel(status: DeliveryPartStatus) {
    return ({ pending: 'Pendente', accepted: 'Aceito pelo provedor', retry_wait: 'Aguardando tentativa', uncertain: 'Incerto — reconciliar', suppressed: 'Suprimido', failed_permanent: 'Falha permanente' } as Record<DeliveryPartStatus, string>)[status]
  }

  return {
    deliveryEvent,
    deliveryInvitations,
    deliveryInvitationId,
    deliveryRows,
    deliveryPreview,
    deliveryPreviewInvitationId,
    deliveryLoading,
    deliveryPreviewLoading,
    deliveryApproving,
    deliveryApprovalConfirmed,
    deliveryError,
    deliveryNotice,
    eligibleDeliveryInvitations,
    selectedDeliveryInvitation,
    selectedInvitationHasDelivery,
    deliveryPreviewValues,
    deliveryPreviewImageUrl,
    deliveryPreviewDateLabel,
    deliveryPreviewDeadlineLabel,
    deliveryCollectionPath,
    resetDeliveries,
    loadDeliveryData,
    openDeliveryPanel,
    loadDeliveryPreview,
    approveFakeDelivery,
    clearDeliveryPreview,
    closeDeliveryPanel,
    deliveryStatusLabel,
    deliveryPartStatusLabel,
  }
}
