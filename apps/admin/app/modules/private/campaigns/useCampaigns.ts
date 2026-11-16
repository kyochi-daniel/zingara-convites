import type { Guest } from '../guests/useGuests'
import type { Invitation } from '../invitations/useInvitations'
import { eventDateOffset, localDateTime } from '../events/date-time'

type RefLike<T> = { value: T }
export type CampaignEvent = { id: string; name: string; status: string; publishedTemplateVersion?: number; rsvpDeadline: string; timeZone: string }
export type CampaignConnection = { connectionId: string; revision: number; channel: 'baileys' | 'cloud' }
export type Campaign = {
  id: string; eventId: string; status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled'
  intervalMs: number; previewHash: string; recipientCount: number; approvedMode: 'fake' | 'real'
  scheduledAt?: string | null; cancelledAt?: string | null; createdAt?: string; updatedAt?: string
  counts?: Record<string, number>
  items?: Array<{ deliveryId: string; invitationId: string; status: string; mediaStatus: string; textStatus: string }>
}
export type CampaignPreview = {
  previewHash: string; intervalMs: number
  items: Array<{ invitationId: string; recipient: { name: string; phone: string; whatsappConsent: boolean }
    text: string; link: string; mode: 'fake' | 'real'; previewHash: string; channel?: 'baileys' | 'cloud'
    officialTemplate?: { name: string; language: string; variables: string[]; revision: number } }>
}

function statusCode(error: unknown) {
  if (!error || typeof error !== 'object') return 0
  return Number('statusCode' in error ? error.statusCode : 'status' in error ? error.status : 0)
}

export function useCampaigns(dependencies: { organizationId: RefLike<string>; csrfToken: RefLike<string>; event: RefLike<CampaignEvent> }) {
  const guests = ref<Guest[]>([])
  const guestTotal = ref(0)
  const guestPage = ref(1)
  const guestQuery = ref('')
  const invitations = ref<Invitation[]>([])
  const selectedGuests = ref<Guest[]>([])
  const campaigns = ref<Campaign[]>([])
  const currentCampaign = ref<Campaign | null>(null)
  const historyLoadedAt = ref('')
  const preview = ref<CampaignPreview | null>(null)
  const intervalMs = ref(5000)
  const sendTiming = ref<'immediate' | 'scheduled'>('immediate')
  const scheduledLocal = ref('')
  const reviewConfirmed = ref(false)
  const resumeConfirmed = ref(false)
  const cancelConfirmed = ref(false)
  const connection = ref<CampaignConnection | null>(null)
  const connectionState = ref('unknown')
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  let requestSerial = 0
  let selectionRevision = 0

  function invitationFor(guestId: string) { return invitations.value.find(item => item.guestId === guestId) }
  function recipientBlocker(guest: Guest) {
    if (!guest.whatsappConsent) return 'Sem consentimento WhatsApp'
    const invitation = invitationFor(guest.id)
    if (!invitation) return 'Convite ainda não emitido'
    if (invitation.revokedAt) return 'Convite revogado'
    if (invitation.responseStatus !== 'pending') return 'RSVP já respondido'
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) return 'Convite expirado'
    return ''
  }
  const eligibilityDeadline = computed(() => {
    const deadlines = [dependencies.event.value.rsvpDeadline,
      ...selectedGuests.value.flatMap(guest => {
        const expiresAt = invitationFor(guest.id)?.expiresAt
        return expiresAt ? [expiresAt] : []
      })]
      .map(value => new Date(value).getTime())
      .filter(Number.isFinite)
    return deadlines.length ? Math.min(...deadlines) : null
  })
  const latestSafeStart = computed(() => {
    if (eligibilityDeadline.value === null || !selectedGuests.value.length || !Number.isInteger(intervalMs.value)) return null
    return new Date(eligibilityDeadline.value - Math.max(0, selectedGuests.value.length - 1) * intervalMs.value).toISOString()
  })
  const blockers = computed(() => {
    const result: string[] = []
    if (!selectedGuests.value.length) result.push('Selecione os destinatários da campanha.')
    if (selectedGuests.value.some(guest => !guest.whatsappConsent)) result.push('Há contatos sem consentimento WhatsApp.')
    if (selectedGuests.value.some(guest => guest.whatsappConsent && recipientBlocker(guest))) result.push('Emita ou revise os convites dos contatos selecionados.')
    if (!connection.value || connectionState.value !== 'connected') result.push('Conecte o WhatsApp da organização antes de preparar a campanha.')
    if (!dependencies.event.value.publishedTemplateVersion) result.push('Publique o modelo do evento antes de preparar a campanha.')
    if (dependencies.event.value.status === 'cancelled') result.push('O evento está cancelado.')
    if (!Number.isInteger(intervalMs.value) || intervalMs.value < 2000 || intervalMs.value > 3_600_000) result.push('O intervalo deve ficar entre 2 e 3.600 segundos.')
    if (sendTiming.value === 'scheduled') {
      if (!scheduledLocal.value) result.push('Informe a data e a hora do agendamento.')
      else {
        const instant = scheduledInstant()
        if (!instant) result.push('Informe uma data e hora válidas no fuso do evento.')
        else if (new Date(instant).getTime() <= Date.now()) result.push('O agendamento deve ficar no futuro.')
        else if (eligibilityDeadline.value !== null && new Date(instant).getTime()
          + Math.max(0, selectedGuests.value.length - 1) * intervalMs.value >= eligibilityDeadline.value) {
          result.push('O lote terminaria no prazo de resposta. Agende o início para antes do limite seguro.')
        }
      }
    }
    return result
  })

  function scheduledInstant() {
    if (sendTiming.value === 'immediate') return null
    if (!scheduledLocal.value) return undefined
    try { return new Date(eventDateOffset(scheduledLocal.value, dependencies.event.value.timeZone)).toISOString() }
    catch { return undefined }
  }

  function invalidatePreview() {
    selectionRevision++
    preview.value = null
    reviewConfirmed.value = false
  }
  function resetCampaigns() {
    requestSerial++
    guests.value = []
    selectedGuests.value = []
    invitations.value = []
    campaigns.value = []
    currentCampaign.value = null
    historyLoadedAt.value = ''
    connection.value = null
    connectionState.value = 'unknown'
    resumeConfirmed.value = false
    cancelConfirmed.value = false
    sendTiming.value = 'immediate'
    scheduledLocal.value = ''
    invalidatePreview()
    busy.value = false
    error.value = ''
    notice.value = ''
  }
  function selectGuest(guest: Guest, selected: boolean) {
    if (busy.value || (selected && selectedGuests.value.length >= 200)) return
    selectedGuests.value = selected ? [...selectedGuests.value.filter(item => item.id !== guest.id), guest]
      : selectedGuests.value.filter(item => item.id !== guest.id)
    invalidatePreview()
  }
  function setInterval(value: number) { if (!busy.value) { intervalMs.value = value; invalidatePreview() } }
  function setSendTiming(value: 'immediate' | 'scheduled') {
    if (busy.value || sendTiming.value === value) return
    sendTiming.value = value
    if (value === 'immediate') scheduledLocal.value = ''
    invalidatePreview()
  }
  function setScheduledLocal(value: string) {
    if (busy.value || scheduledLocal.value === value) return
    scheduledLocal.value = value
    invalidatePreview()
  }

  // Capture scope once so a response cannot populate a different organization or event.
  async function perform(action: (context: { base: string; eventPath: string; headers: Record<string, string>; current: () => boolean }) => Promise<void>) {
    const organizationId = dependencies.organizationId.value
    const eventId = dependencies.event.value.id
    if (!organizationId || !eventId || busy.value) return
    const requestId = ++requestSerial
    const current = () => requestId === requestSerial && organizationId === dependencies.organizationId.value && eventId === dependencies.event.value.id
    const base = `/api/admin/organizations/${encodeURIComponent(organizationId)}`
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      await action({ base, eventPath: `${base}/events/${encodeURIComponent(eventId)}`, headers: { 'x-csrf-token': dependencies.csrfToken.value }, current })
    } catch (problem) {
      if (current()) {
        invalidatePreview()
        reviewConfirmed.value = false
        resumeConfirmed.value = false
        error.value = statusCode(problem) === 409
          ? 'O conteúdo, o consentimento ou a conexão mudou. Atualize os dados e gere uma nova prévia.'
          : 'Não foi possível concluir a ação. Atualize o estado antes de tentar novamente.'
      }
    } finally { if (requestId === requestSerial) busy.value = false }
  }

  async function loadCampaignData() {
    invalidatePreview()
    await perform(async ({ base, eventPath, current }) => {
      const [guestResult, invitationResult, campaignResult, activeResult] = await Promise.all([
        $fetch<{ items: Guest[]; total: number }>(`${base}/guests`, { query: { page: guestPage.value, limit: 100, ...(guestQuery.value.trim() ? { q: guestQuery.value.trim() } : {}) } }),
        $fetch<{ items: Invitation[] }>(`${eventPath}/invitations`),
        $fetch<{ items: Campaign[] }>(`${eventPath}/campaigns`),
        $fetch<{ active: CampaignConnection | null }>(`${base}/connections/active`),
      ])
      if (!current()) return
      guests.value = guestResult.items
      guestTotal.value = guestResult.total
      invitations.value = invitationResult.items
      campaigns.value = campaignResult.items
      connection.value = activeResult.active
      connectionState.value = 'unknown'
      // Refresh selected contacts from this page without discarding selections on other pages.
      selectedGuests.value = selectedGuests.value.map(guest => guestResult.items.find(item => item.id === guest.id) ?? guest)
      if (activeResult.active) {
        const result = await $fetch<{ status: { state: string } }>(`${base}/connections/evolution/${encodeURIComponent(activeResult.active.connectionId)}/status`)
        if (current()) connectionState.value = result.status.state
      }
    })
  }

  async function prepareInvitations() {
    if (!dependencies.event.value.publishedTemplateVersion || !selectedGuests.value.length) return
    invalidatePreview()
    await perform(async ({ eventPath, headers, current }) => {
      let created = 0
      for (const guest of selectedGuests.value) {
        if (!current()) return
        if (invitationFor(guest.id)) continue
        const result = await $fetch<{ invitation: Invitation }>(`${eventPath}/invitations`, { method: 'POST', headers, body: { guestId: guest.id } })
        if (!current()) return
        invitations.value = [...invitations.value, result.invitation]
        created++
      }
      notice.value = `${created} convites preparados. Nenhuma mensagem foi enviada.`
    })
  }

  async function createPreview() {
    if (blockers.value.length) return
    invalidatePreview()
    const revision = selectionRevision
    const invitationIds = selectedGuests.value.map(guest => invitationFor(guest.id)!.id).sort()
    await perform(async ({ eventPath, headers, current }) => {
      const result = await $fetch<{ campaign: Campaign; preview: CampaignPreview }>(`${eventPath}/campaigns`, {
        method: 'POST', headers, body: {
          invitationIds, intervalMs: intervalMs.value,
          ...(sendTiming.value === 'scheduled' ? { scheduledAt: scheduledInstant() } : {}),
        },
      })
      if (!current() || revision !== selectionRevision) return
      currentCampaign.value = result.campaign
      campaigns.value = [result.campaign, ...campaigns.value.filter(item => item.id !== result.campaign.id)]
      preview.value = result.preview
      notice.value = 'Rascunho preparado. Revise os destinatários, os textos e os links antes de aprovar.'
    })
  }
  async function approveCampaign() {
    const reviewed = preview.value
    const campaign = currentCampaign.value
    if (!reviewed || !campaign || campaign.status !== 'draft' || !reviewConfirmed.value || blockers.value.length
      || campaign.previewHash !== reviewed.previewHash || reviewed.intervalMs !== intervalMs.value
      || (campaign.scheduledAt ?? null) !== scheduledInstant()
      || reviewed.items.length !== selectedGuests.value.length || reviewed.items.some(item => !item.recipient.whatsappConsent)) return
    await perform(async ({ eventPath, headers, current }) => {
      const result = await $fetch<{ campaign: Campaign }>(`${eventPath}/campaigns/${encodeURIComponent(campaign.id)}/approve`, {
        method: 'POST', headers, body: { approve: true, previewHash: reviewed.previewHash },
      })
      if (!current()) return
      currentCampaign.value = result.campaign
      campaigns.value = campaigns.value.map(item => item.id === result.campaign.id ? result.campaign : item)
      invalidatePreview()
      notice.value = result.campaign.status === 'scheduled'
        ? 'Agendamento registrado. A campanha aguardará o horário indicado antes de iniciar.'
        : 'Aprovação registrada. Acompanhe o processamento; aceitação do provedor não confirma entrega.'
    })
  }
  async function refreshCampaign(id = currentCampaign.value?.id) {
    if (!id || !campaigns.value.some(item => item.id === id)) return
    invalidatePreview()
    resumeConfirmed.value = false
    await perform(async ({ eventPath, current }) => {
      const result = await $fetch<{ campaign: Campaign }>(`${eventPath}/campaigns/${encodeURIComponent(id)}`)
      if (current()) {
        currentCampaign.value = result.campaign
        campaigns.value = campaigns.value.map(item => item.id === result.campaign.id ? result.campaign : item)
        historyLoadedAt.value = new Date().toISOString()
      }
    })
  }
  async function reopenDraft() {
    const campaign = currentCampaign.value
    if (!campaign || campaign.status !== 'draft') return
    invalidatePreview()
    await perform(async ({ eventPath, current }) => {
      const result = await $fetch<{ campaign: Campaign; preview: CampaignPreview }>(`${eventPath}/campaigns/${encodeURIComponent(campaign.id)}/preview`)
      if (!current()) return
      currentCampaign.value = result.campaign
      intervalMs.value = result.preview.intervalMs
      sendTiming.value = result.campaign.scheduledAt ? 'scheduled' : 'immediate'
      scheduledLocal.value = result.campaign.scheduledAt
        ? localDateTime(result.campaign.scheduledAt, dependencies.event.value.timeZone)
        : ''
      selectedGuests.value = result.preview.items.flatMap(item => {
        const invitation = invitations.value.find(invitation => invitation.id === item.invitationId)
        return invitation ? [{ id: invitation.guestId, name: item.recipient.name, phone: item.recipient.phone,
          whatsappConsent: item.recipient.whatsappConsent, tags: [], notes: '' }] : []
      })
      preview.value = result.preview
    })
  }
  async function changeState(action: 'pause' | 'resume') {
    const campaign = currentCampaign.value
    if (!campaign || campaign.status !== (action === 'pause' ? 'running' : 'paused') || (action === 'resume' && !resumeConfirmed.value)) return
    await perform(async ({ eventPath, headers, current }) => {
      const result = await $fetch<{ campaign: Campaign }>(`${eventPath}/campaigns/${encodeURIComponent(campaign.id)}/${action}`, { method: 'POST', headers, body: {} })
      if (!current()) return
      currentCampaign.value = { ...campaign, ...result.campaign }
      campaigns.value = campaigns.value.map(item => item.id === result.campaign.id ? result.campaign : item)
      resumeConfirmed.value = false
      notice.value = action === 'pause' ? 'Pausa registrada. Tentativas já iniciadas podem terminar.' : 'Retomada registrada. O worker revalidará cada destinatário.'
    })
  }

  async function cancelCampaign() {
    const campaign = currentCampaign.value
    if (!campaign || !cancelConfirmed.value || !['draft', 'scheduled', 'running', 'paused'].includes(campaign.status)) return
    await perform(async ({ eventPath, headers, current }) => {
      const result = await $fetch<{ campaign: Campaign }>(`${eventPath}/campaigns/${encodeURIComponent(campaign.id)}/cancel`, {
        method: 'POST', headers, body: {},
      })
      if (!current()) return
      currentCampaign.value = result.campaign
      campaigns.value = campaigns.value.map(item => item.id === result.campaign.id ? result.campaign : item)
      cancelConfirmed.value = false
      resumeConfirmed.value = false
      invalidatePreview()
      notice.value = 'Campanha cancelada. Nenhuma nova tentativa será iniciada.'
    })
  }

  return { guests, guestTotal, guestPage, guestQuery, invitations, selectedGuests, campaigns, currentCampaign, historyLoadedAt, preview, intervalMs,
    sendTiming, scheduledLocal, latestSafeStart, reviewConfirmed, resumeConfirmed, cancelConfirmed, connection, connectionState, busy, error, notice, blockers,
    invitationFor, recipientBlocker, scheduledInstant, resetCampaigns, invalidatePreview, selectGuest, setInterval, setSendTiming, setScheduledLocal,
    loadCampaignData, prepareInvitations, createPreview, approveCampaign, refreshCampaign, reopenDraft, cancelCampaign,
    pauseCampaign: () => changeState('pause'), resumeCampaign: () => changeState('resume') }
}
