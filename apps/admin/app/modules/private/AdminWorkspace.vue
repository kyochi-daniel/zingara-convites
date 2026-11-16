<script setup lang="ts">
import EditorialTemplate from '~/components/templates/EditorialTemplate.vue'
import ClassicTemplate from '~/components/templates/ClassicTemplate.vue'
import EventMessageEditor from '~/components/EventMessageEditor.vue'
import AssistantChat from '~/components/AssistantChat.vue'
import DesignShell from '~/components/DesignShell.vue'
import DesignDashboard from '~/components/DesignDashboard.vue'
import DesignGuests from '~/components/DesignGuests.vue'
import DesignEventEditor from '~/components/DesignEventEditor.vue'
import DesignEventCard from '~/components/DesignEventCard.vue'
import DesignCsvImport from '~/components/DesignCsvImport.vue'
import EvolutionConsole from '~/components/EvolutionConsole.vue'
import CampaignWorkspace from '~/modules/private/campaigns/CampaignWorkspace.vue'
import { resolveAssistantNavigation, type CampaignStep } from '~/modules/private/assistant/useAssistant'
import { useAutomations } from '~/modules/private/automations/useAutomations'
import { useDeliveries } from '~/modules/private/deliveries/useDeliveries'
import { useEvolutionConsole } from '~/modules/private/evolution/useEvolutionConsole'
import { EVENT_TIME_ZONES } from '~/modules/private/events/date-time'
import { useEvents, type EventItem } from '~/modules/private/events/useEvents'
import { useGuestEventStatus } from '~/modules/private/guests/useGuestEventStatus'
import { useGuests } from '~/modules/private/guests/useGuests'
import EventReportPanel from '~/modules/private/invitations/EventReportPanel.vue'
import { useInvitations } from '~/modules/private/invitations/useInvitations'
import { organizationId as orgId, useOrganizations } from '~/modules/private/organizations/useOrganizations'
import { useTemplates } from '~/modules/private/templates/useTemplates'

type Admin = { email: string }
type Area = 'home' | 'settings' | 'organizations' | 'events' | 'guests' | 'template' | 'invitations' | 'connection' | 'deliveries' | 'automations' | 'campaigns'
const timeZoneLabel = (timeZone?: string) => {
  if (!timeZone) return 'Fuso não definido'
  const zone = EVENT_TIME_ZONES.find(item => item.value === timeZone)
  if (zone) return `Horário de ${zone.label}`
  if (['UTC', 'Etc/UTC', 'Etc/GMT'].includes(timeZone)) return 'Horário universal'
  return `Horário de ${timeZone.split('/').at(-1)!.replaceAll('_', ' ')}`
}
const eventDateTimeLabel = (value?: string, timeZone?: string) => value && timeZone
  ? `${new Date(value).toLocaleString('pt-BR', { timeZone })} · ${timeZoneLabel(timeZone)}`
  : 'Não definido'
const loading = ref(true)
const admin = ref<Admin | null>(null)
const csrfToken = ref('')
const loginEmail = ref('')
const loginPassword = ref('')
const loginError = ref('')
const activeArea = ref<Area>('organizations')
const error = ref('')
const notice = ref('')
const saving = ref(false)
const {
  organizations,
  selectedOrganizationId,
  editingOrganizationId,
  organizationForm,
  selectedOrganization,
  organizationOptions,
  formTitle,
  resetOrganizationForm,
  loadOrganizations,
  editOrganization,
  saveOrganization,
} = useOrganizations({ csrfToken, error, notice, saving })

const events = ref<EventItem[]>([])
const campaignEvent = ref<EventItem | null>(null)
const campaignStep = ref<CampaignStep>('import')
function openCampaignPanel(event: EventItem, step: CampaignStep = 'import') {
  campaignEvent.value = event
  campaignStep.value = step
  activeArea.value = 'campaigns'
}
const {
  invitationEvent,
  invitationGuests,
  invitationGuestId,
  invitationGuestQuery,
  invitationGuestSearch,
  invitationGuestPage,
  invitationGuestTotal,
  invitationItems,
  dashboardTotals,
  dashboardEventId,
  guestStatusById,
  invitationLoading,
  invitationSaving,
  invitationError,
  invitationNotice,
  revealedInvitation,
  invitationConfirmation,
  invitationGuestPages,
  selectedInvitationGuest,
  resetInvitations,
  loadDashboardTotals,
  loadInvitations,
  openInvitations,
  searchInvitationGuests,
  changeInvitationGuestPage,
  issueInvitation,
  revealInvitationLink,
  copyInvitationLink,
  confirmInvitationAction,
  invitationStatus,
  companionSummary,
} = useInvitations({ selectedOrganizationId, csrfToken, events, activeArea })
const {
  editingEventId,
  eventForm,
  eventTitle,
  publishedEventEditId,
  publishedEventRevision,
  publishedEventEditSaving,
  publishedEventCancelId,
  publishedEventCancelConfirmed,
  publishedEventCancelSaving,
  publishedEventNotice,
  publishedEventError,
  publishedEventFeedbackId,
  publishedEventForm,
  resetEventForm,
  resetEvents,
  loadEvents,
  editEvent,
  saveEvent,
  openPublishedEventRevision,
  closePublishedEventRevision,
  revisePublishedEvent,
  startPublishedEventCancellation,
  closePublishedEventCancellation,
  cancelPublishedEvent,
} = useEvents({ events, selectedOrganizationId, csrfToken, error, notice, saving, loadDashboardTotals })
const {
  templateForm,
  templateLoading,
  templateSaving,
  templatePublishing,
  templateError,
  templateNotice,
  previewSize,
  publishedVersion,
  viewingPublication,
  templateEvent,
  displayedTemplate,
  displayedImageUrl,
  previewValues,
  resolvedPreview,
  messagePreview,
  resetTemplates,
  openTemplateEditor,
  closeTemplateEditor,
  saveTemplateDraft,
  publishTemplate,
  viewPublishedVersion,
  editCurrentDraft,
  uploadTemplateImage,
  removeTemplateImage,
} = useTemplates({ selectedOrganizationId, csrfToken, events, activeArea })
const dashboardGuestTotal = ref(0)
const {
  guests,
  guestTotal,
  guestPage,
  guestPageSize,
  guestLoading,
  guestQuery,
  guestSearch,
  guestTag,
  editingGuestId,
  guestForm,
  csvName,
  csvRows,
  acceptedRows,
  importing,
  guestTitle,
  loadGuests,
  searchDesignGuests,
  editGuest,
  resetGuestForm,
  saveGuest,
  changeGuestPage,
  changeGuestPageSize,
  clearCsv,
  setAccepted,
  chooseCsv,
  importCsv,
} = useGuests({ selectedOrganizationId, csrfToken, dashboardGuestTotal, error, notice, saving })
const {
  guestRsvpEventId,
  guestRsvpStatusById,
  guestRsvpLoading,
  guestRsvpError,
  guestRsvpEvents,
  guestRsvpEvent,
  resetGuestRsvpSelection,
  selectGuestRsvpEvent,
  syncGuestRsvpSelection,
} = useGuestEventStatus({ selectedOrganizationId, events })
const {
  deliveryEvent,
  deliveryInvitationId,
  deliveryRows,
  deliveryPreview,
  deliveryLoading,
  deliveryPreviewLoading,
  deliveryApproving,
  deliveryApprovalConfirmed,
  deliveryError,
  deliveryNotice,
  eligibleDeliveryInvitations,
  selectedInvitationHasDelivery,
  deliveryPreviewImageUrl,
  deliveryPreviewDateLabel,
  deliveryPreviewDeadlineLabel,
  resetDeliveries,
  loadDeliveryData,
  openDeliveryPanel,
  loadDeliveryPreview,
  approveFakeDelivery,
  clearDeliveryPreview,
  closeDeliveryPanel,
  deliveryStatusLabel,
  deliveryPartStatusLabel,
} = useDeliveries({ selectedOrganizationId, csrfToken, activeArea })
const {
  automationEvent,
  automationRules,
  automationType,
  automationForm,
  automationPreview,
  automationPreviewRevision,
  automationJobs,
  automationGuests,
  automationGuestQuery,
  automationGuestId,
  automationSuppressionReason,
  automationSuppressionConfirmed,
  automationMode,
  automationLoading,
  automationSaving,
  automationPreviewLoading,
  automationActivating,
  automationSuppressing,
  automationError,
  automationNotice,
  selectedAutomationType,
  automationFormDirty,
  automationRule,
  automationRuleActive,
  automationAvailableAudiences,
  automationAvailableAnchors,
  automationUsesFixedTime,
  automationTextTokens,
  automationTypeOptions,
  automationTypeLabel,
  automationAudienceLabel,
  automationAnchorLabel,
  automationResponseLabel,
  automationJobStatusLabel,
  automationJobTypeLabel,
  automationSampleReason,
  setAutomationType,
  resetAutomations,
  openAutomationPanel,
  saveAutomationRule,
  previewAutomation,
  activateAutomation,
  loadAutomationJobs,
  searchAutomationGuests,
  suppressAutomationGuest,
  closeAutomationPanel,
} = useAutomations({ selectedOrganizationId, csrfToken, activeArea })
const {
  installation: evolutionInstallation,
  inventory: evolutionInventory,
  activeConnection,
  statuses: evolutionStatuses,
  templates: evolutionTemplates,
  loading: evolutionLoading,
  saving: evolutionSaving,
  error: evolutionError,
  notice: evolutionNotice,
  pairing: evolutionPairing,
  stopEvolutionPairing,
  resetEvolutionOrganization,
  loadEvolutionArea,
  createEvolutionConnection,
  linkEvolutionConnection,
  diagnoseEvolution,
  connectEvolution,
  checkEvolutionNumber,
  selectActiveConnection,
  saveEvolutionTemplate,
} = useEvolutionConsole({ selectedOrganizationId, csrfToken })

const csrfHeaders = computed(() => ({ 'x-csrf-token': csrfToken.value }))
const dashboardAdminName = computed(() => admin.value?.email.split('@')[0] || 'Admin')
const shellArea = computed(() => activeArea.value === 'home' || activeArea.value === 'guests' ? activeArea.value
  : ['events', 'template', 'invitations', 'deliveries', 'automations', 'campaigns'].includes(activeArea.value) ? 'events' : 'other')
const shellTitle = computed(() => ({ home: 'Início', settings: 'Configurações', events: 'Eventos', guests: 'Convidados', organizations: 'Organizações',
  template: 'Editar convite', invitations: 'Convites', connection: 'Conexão WhatsApp', deliveries: 'Envios', automations: 'Automações', campaigns: 'Campanha de convites' })[activeArea.value])

function navigateShell(area: string) {
  if (area === 'home' || area === 'events' || area === 'guests') activeArea.value = area
  else if (area === 'check-in') activeArea.value = 'guests'
  else if (area === 'connection') void openEvolutionArea()
  else if (area === 'settings' || area === 'organizations') activeArea.value = area
}
function navigateDashboard(area: 'events' | 'guests' | 'invitations') {
  if (area === 'invitations') {
    const event = events.value.find(item => item.publishedTemplateVersion && item.status !== 'cancelled')
    if (event) void openInvitations(event)
    else activeArea.value = 'events'
  } else activeArea.value = area
}
function createDashboard(kind: 'event' | 'invitation') {
  if (kind === 'invitation') return navigateDashboard('invitations')
  resetEventForm()
  activeArea.value = 'events'
}
function focusGuestTool(id: string) {
  activeArea.value = 'guests'
  void nextTick(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
function editDesignGuest(id: string) {
  const guest = guests.value.find(item => item.id === id)
  if (guest) editGuest(guest)
  focusGuestTool('guest-name')
}
function statusCodeOf(value: unknown) {
  return typeof value === 'object' && value && 'statusCode' in value ? Number(value.statusCode) : undefined
}
async function openEvolutionArea() {
  activeArea.value = 'connection'
  resetEvolutionOrganization()
  await loadEvolutionArea()
}
async function handleAssistantNavigation(value: unknown) {
  const organizationId = selectedOrganizationId.value
  const isEventDestination = typeof value === 'object' && value !== null && 'type' in value && value.type === 'event'
  if (isEventDestination) await loadEvents()
  if (!organizationId || organizationId !== selectedOrganizationId.value) return
  const navigation = resolveAssistantNavigation(value, events.value.map(event => event.id))
  if (!navigation) return
  if (navigation.type === 'area') {
    if (navigation.area === 'events') await loadEvents()
    else if (navigation.area === 'guests') await loadGuests()
    else if (navigation.area === 'home') await Promise.all([loadEvents(), loadGuests()])
    if (organizationId !== selectedOrganizationId.value) return
    navigateShell(navigation.area)
    return
  }
  const event = events.value.find(item => item.id === navigation.eventId)
  if (!event) return
  if (navigation.area === 'events') {
    editEvent(event)
    activeArea.value = 'events'
  } else if (navigation.area === 'template') await openTemplateEditor(event)
  else if (navigation.area === 'campaigns') openCampaignPanel(event, navigation.step)
  else if (navigation.area === 'invitations') await openInvitations(event)
  else if (navigation.area === 'deliveries') await openDeliveryPanel(event)
  else await openAutomationPanel(event)
}

onMounted(async () => {
  try {
    const session = await $fetch<{ admin: Admin; csrfToken: string }>('/api/admin/auth/session')
    admin.value = session.admin
    csrfToken.value = session.csrfToken
    await loadOrganizations()
    if (selectedOrganizationId.value) activeArea.value = 'home'
  } catch (problem: unknown) {
    admin.value = null
    if (statusCodeOf(problem) !== 401) loginError.value = 'Não foi possível verificar a sessão. Tente entrar novamente.'
  } finally { loading.value = false }
})

watch(selectedOrganizationId, async id => {
  error.value = ''
  notice.value = ''
  resetEvents()
  dashboardEventId.value = ''
  dashboardGuestTotal.value = 0
  guestStatusById.value = {}
  dashboardTotals.value = { pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 }
  guests.value = []
  guestPage.value = 1
  guestSearch.value = ''
  guestTag.value = ''
  resetGuestRsvpSelection()
  resetTemplates()
  resetGuestForm()
  resetInvitations()
  resetEvolutionOrganization()
  resetDeliveries()
  campaignEvent.value = null
  if (activeArea.value === 'campaigns') activeArea.value = 'events'
  if (activeArea.value === 'invitations') activeArea.value = 'events'
  if (activeArea.value === 'deliveries') activeArea.value = 'events'
  if (activeArea.value === 'automations') activeArea.value = 'events'
  resetAutomations()
  clearCsv()
  if (id) await Promise.all([loadEvents(), loadGuests(), ...(activeArea.value === 'connection' ? [loadEvolutionArea()] : [])])
})

watch([
  activeArea,
  () => events.value.map(event => `${event.id}:${event.status}:${event.publishedTemplateVersion ?? 0}`).join('|'),
], ([area]) => {
  if (area === 'guests' && selectedOrganizationId.value) void syncGuestRsvpSelection()
})

watch(activeArea, area => {
  if (area !== 'deliveries') clearDeliveryPreview()
})

async function login() {
  loginError.value = ''
  try {
    const session = await $fetch<{ admin: Admin; csrfToken: string }>('/api/admin/auth/login', {
      method: 'POST', body: { email: loginEmail.value, password: loginPassword.value },
    })
    admin.value = session.admin
    csrfToken.value = session.csrfToken
    loginPassword.value = ''
    await loadOrganizations()
    if (selectedOrganizationId.value) activeArea.value = 'home'
  } catch { loginError.value = 'Não foi possível entrar. Confira os dados e tente novamente.' }
}
async function logout() {
  try {
    await $fetch('/api/admin/auth/logout', { method: 'POST', headers: csrfHeaders.value })
    admin.value = null
    csrfToken.value = ''
    organizations.value = []
    selectedOrganizationId.value = ''
    resetInvitations()
    resetEvolutionOrganization()
    resetDeliveries()
    resetEvents()
    resetTemplates()
    resetAutomations()
    resetOrganizationForm()
  } catch { error.value = 'Não foi possível encerrar a sessão. Tente novamente.' }
}
</script>

<template>
  <div :class="admin ? 'admin-root' : 'admin-shell'">
    <section v-if="loading" class="loading-card" role="status" aria-live="polite">
      <span class="eyebrow">Zingara Convites</span><p>Verificando sua sessão…</p>
    </section>

    <section v-else-if="!admin" class="login-layout" aria-labelledby="login-title" role="main">
      <div class="login-intro">
        <span class="eyebrow">Painel administrativo</span>
        <h1>Organize cada detalhe dos seus convites.</h1>
        <p>Entre para gerenciar organizações, eventos e contatos.</p>
      </div>
      <form class="panel login-card" @submit.prevent="login">
        <div><span class="eyebrow">Acesso restrito</span><h2 id="login-title">Entrar</h2></div>
        <label for="login-email">E-mail</label>
        <input id="login-email" v-model="loginEmail" type="email" autocomplete="username" required maxlength="254">
        <label for="login-password">Senha</label>
        <input id="login-password" v-model="loginPassword" type="password" autocomplete="current-password" required maxlength="1024">
        <p v-if="loginError" class="form-message error" role="alert">{{ loginError }}</p>
        <button class="button primary" type="submit">Entrar no painel</button>
      </form>
    </section>

    <DesignShell
      v-else
      :class="{ 'has-campaign': activeArea === 'campaigns' }"
      :active="shellArea"
      :active-area="activeArea"
      :page-title="shellTitle"
      :admin-name="dashboardAdminName"
      :organizations="organizationOptions"
      :selected-organization-id="selectedOrganizationId"
      @navigate="navigateShell"
      @select-organization="selectedOrganizationId = $event"
      @logout="logout"
    >

      <div v-if="error" class="global-message form-message error" role="alert">{{ error }}</div>
      <div v-if="notice" class="global-message form-message success" role="status">{{ notice }}</div>

      <DesignDashboard v-if="activeArea === 'home'" :admin-name="dashboardAdminName" :events="events" :guest-total="dashboardGuestTotal" :invitation-totals="dashboardTotals" :invitation-event-id="dashboardEventId" range-label="Dados atuais" @navigate="navigateDashboard" @create="createDashboard" @action="focusGuestTool('csv-file')" />

      <section v-else-if="activeArea === 'settings'" class="workspace-grid settings-grid" aria-labelledby="settings-title">
        <header class="panel organization-panel settings-heading"><span class="eyebrow">Sistema</span><h2 id="settings-title">Configurações</h2><p>Gerencie a organização e o canal usado pelos convites.</p></header>
        <button class="panel organization-panel settings-card" type="button" @click="activeArea = 'organizations'"><span class="eyebrow">Conta</span><strong>Organizações</strong><small>Identidade visual, nome e e-mail de resposta.</small></button>
        <button class="panel organization-panel settings-card" type="button" @click="openEvolutionArea"><span class="eyebrow">Canal</span><strong>WhatsApp</strong><small>Servidor, instâncias Evolution, QR e Cloud API oficial.</small></button>
      </section>

      <section v-else-if="activeArea === 'organizations'" class="workspace-grid">
        <h1 class="visually-hidden">{{ selectedOrganization?.name || 'Suas organizações' }}</h1>
        <section class="panel organization-panel" aria-labelledby="organizations-title">
          <div class="section-heading">
            <div><span class="eyebrow">Contas</span><h2 id="organizations-title">Organizações</h2></div>
            <span class="count-pill" aria-label="Total de organizações">{{ organizations.length }}</span>
          </div>
          <ul v-if="organizations.length" class="organization-list">
            <li v-for="organization in organizations" :key="orgId(organization)">
              <span class="organization-mark" :style="{ backgroundColor: organization.visualIdentity?.primaryColor || '#8d6a4f' }" aria-hidden="true">{{ organization.name.slice(0, 1).toUpperCase() }}</span>
              <span class="organization-info"><strong>{{ organization.name }}</strong><small>{{ organization.settings?.replyToEmail || 'Sem e-mail de resposta' }}</small></span>
              <button class="button quiet edit-button" type="button" @click="editOrganization(organization)">Editar</button>
            </li>
          </ul>
          <div v-else class="empty-state"><span class="empty-mark" aria-hidden="true">✳</span><h3>Nenhuma organização ainda</h3><p>Cadastre a primeira para começar.</p></div>
        </section>

        <form class="panel organization-form" @submit.prevent="saveOrganization">
          <div><span class="eyebrow">Configuração</span><h2>{{ formTitle }}</h2><p class="form-intro">Defina as informações que identificam a organização.</p></div>
          <label for="organization-name">Nome <span aria-hidden="true">*</span></label>
          <input id="organization-name" v-model.trim="organizationForm.name" type="text" required maxlength="120" autocomplete="organization">
          <div class="field-row">
            <div><label for="organization-color">Cor principal</label><div class="color-input"><input id="organization-color" v-model="organizationForm.primaryColor" type="text" pattern="^#[0-9a-fA-F]{6}$" maxlength="7" placeholder="#75482f"><span>Opcional, hexadecimal</span></div></div>
            <div><label for="organization-email">E-mail de resposta</label><input id="organization-email" v-model.trim="organizationForm.replyToEmail" type="email" maxlength="254" autocomplete="email"></div>
          </div>
          <label for="organization-logo">URL do logo</label>
          <input id="organization-logo" v-model.trim="organizationForm.logoUrl" type="url" maxlength="2048" placeholder="https://exemplo.com/logo.png">
          <div class="form-actions">
            <button v-if="editingOrganizationId" class="button quiet" type="button" @click="resetOrganizationForm">Cancelar edição</button>
            <button class="button primary" type="submit" :disabled="saving">{{ saving ? 'Salvando…' : editingOrganizationId ? 'Salvar alterações' : 'Criar organização' }}</button>
          </div>
        </form>
      </section>

      <section v-else-if="activeArea === 'events'" class="management-grid">
        <section class="panel record-panel" aria-labelledby="events-title">
          <div class="section-heading"><div><span class="eyebrow">Agenda</span><h2 id="events-title">Eventos</h2></div><span class="count-pill">{{ events.length }}</span></div>
          <div v-if="events.length" class="record-list">
            <DesignEventCard
              v-for="event in events"
              :key="event.id"
              :event="event"
              @edit="editEvent(event)"
              @template="openTemplateEditor(event)"
              @invitations="openInvitations(event)"
              @delivery="openDeliveryPanel(event)"
              @automations="openAutomationPanel(event)"
              @revise="openPublishedEventRevision(event)"
              @cancel="startPublishedEventCancellation(event)"
            >
              <div class="form-actions"><button class="button quiet" type="button" @click="openCampaignPanel(event)">Preparar campanha</button></div>
              <form v-if="publishedEventEditId === event.id" class="event-revision-form" @submit.prevent="revisePublishedEvent(event)">
                <div><span class="eyebrow">Revisão {{ publishedEventRevision }}</span><h4>Nova versão do evento</h4><p>Campos atualizados seguem o fuso selecionado e podem disparar a regra de aviso de alteração.</p></div>
                <label :for="`revision-name-${event.id}`">Nome</label><input :id="`revision-name-${event.id}`" v-model.trim="publishedEventForm.name" maxlength="120" required>
                <label :for="`revision-description-${event.id}`">Descrição</label><textarea :id="`revision-description-${event.id}`" v-model.trim="publishedEventForm.description" maxlength="2000" rows="2"></textarea>
                <div class="field-row"><div><label :for="`revision-location-${event.id}`">Local</label><input :id="`revision-location-${event.id}`" v-model.trim="publishedEventForm.location" maxlength="160" required></div><div><label :for="`revision-address-${event.id}`">Endereço</label><input :id="`revision-address-${event.id}`" v-model.trim="publishedEventForm.address" maxlength="500" required></div></div>
                <div class="field-row"><div><label :for="`revision-start-${event.id}`">Início local</label><input :id="`revision-start-${event.id}`" v-model.trim="publishedEventForm.startsAt" required placeholder="2026-11-15T18:00"></div><div><label :for="`revision-end-${event.id}`">Término local</label><input :id="`revision-end-${event.id}`" v-model.trim="publishedEventForm.endsAt" required placeholder="2026-11-15T23:00"></div></div>
                <label :for="`revision-rsvp-${event.id}`">Prazo para confirmar presença</label><input :id="`revision-rsvp-${event.id}`" v-model.trim="publishedEventForm.rsvpDeadline" type="text" inputmode="numeric" name="rsvpDeadline" placeholder="2026-11-10T23:59" required>
                <label :for="`revision-zone-${event.id}`">Fuso horário</label><select :id="`revision-zone-${event.id}`" v-model="publishedEventForm.timeZone" required><option v-for="zone in EVENT_TIME_ZONES" :key="zone.value" :value="zone.value">{{ zone.label }}</option></select>
                <small>Digite hora local ou ISO com offset. Fuso atual: {{ timeZoneLabel(event.timeZone) }}.</small>
                <p v-if="publishedEventError" class="form-message error" role="alert">{{ publishedEventError }}</p>
                <p v-if="publishedEventNotice" class="form-message success" role="status">{{ publishedEventNotice }}</p>
                <div class="form-actions"><button class="button quiet" type="button" @click="closePublishedEventRevision">Fechar</button><button class="button primary" type="submit" :disabled="publishedEventEditSaving">{{ publishedEventEditSaving ? 'Salvando revisão…' : 'Salvar revisão e avisar' }}</button></div>
              </form>
              <div v-if="publishedEventCancelId === event.id" class="event-revision-form cancellation-confirmation">
                <h4>Confirmar cancelamento</h4><p>Esta ação cancela o evento e pode planejar avisos para os convidados, conforme as regras ativas.</p>
                <label class="check-field" :for="`cancel-confirm-${event.id}`"><input :id="`cancel-confirm-${event.id}`" v-model="publishedEventCancelConfirmed" type="checkbox"> Confirmo cancelar “{{ event.name }}”.</label>
                <p v-if="publishedEventError" class="form-message error" role="alert">{{ publishedEventError }}</p>
                <p v-if="publishedEventNotice" class="form-message success" role="status">{{ publishedEventNotice }}</p>
                <div class="form-actions"><button class="button quiet" type="button" @click="closePublishedEventCancellation">Voltar</button><button class="button quiet danger-quiet" type="button" :disabled="!publishedEventCancelConfirmed || publishedEventCancelSaving" @click="cancelPublishedEvent(event)">{{ publishedEventCancelSaving ? 'Cancelando…' : 'Confirmar cancelamento' }}</button></div>
              </div>
              <p v-if="publishedEventFeedbackId === event.id && publishedEventError && publishedEventEditId !== event.id && publishedEventCancelId !== event.id" class="form-message error" role="alert">{{ publishedEventError }}</p>
              <p v-if="publishedEventFeedbackId === event.id && publishedEventNotice && publishedEventEditId !== event.id && publishedEventCancelId !== event.id" class="form-message success" role="status">{{ publishedEventNotice }}</p>
            </DesignEventCard>
          </div>
          <div v-else class="empty-state"><span class="empty-mark" aria-hidden="true">✳</span><h3>Seu próximo evento começa aqui</h3><p>Cadastre datas, local e regras de acompanhantes.</p></div>
        </section>

        <DesignEventEditor :event-form="eventForm" :editing-event-id="editingEventId" :saving="saving" :event-status="events.find(item => item.id === editingEventId)?.status" @save="saveEvent" @cancel="resetEventForm" />
      </section>

      <EvolutionConsole
        v-else-if="activeArea === 'connection'"
        :organization-name="selectedOrganization?.name"
        :installation="evolutionInstallation"
        :inventory="evolutionInventory"
        :statuses="evolutionStatuses"
        :templates="evolutionTemplates"
        :active-connection-id="activeConnection?.connectionId"
        :busy="evolutionLoading || evolutionSaving"
        :error="evolutionError"
        :notice="evolutionNotice"
        :pairing="evolutionPairing"
        @stop-pairing="stopEvolutionPairing"
        @refresh="loadEvolutionArea"
        @create="createEvolutionConnection"
        @link="linkEvolutionConnection"
        @status="diagnoseEvolution"
        @connect="connectEvolution"
        @number-check="checkEvolutionNumber"
        @save-template="saveEvolutionTemplate"
        @activate="selectActiveConnection"
      />

      <section v-else-if="activeArea === 'deliveries'" class="invitation-shell" aria-labelledby="delivery-title">
        <header class="template-page-heading">
          <div><span class="eyebrow">Envios iniciais</span><h2 id="delivery-title">{{ deliveryEvent?.name || 'Prévia e envios' }}</h2><p>{{ selectedOrganization?.name }} · Revise o destinatário e conteúdo antes de aprovar.</p></div>
          <button class="button quiet" type="button" @click="closeDeliveryPanel">Voltar aos eventos</button>
        </header>
        <p v-if="deliveryError" class="form-message error" role="alert">{{ deliveryError }}</p>
        <p v-if="deliveryNotice" class="form-message success" role="status">{{ deliveryNotice }}</p>
        <section class="panel delivery-preview-panel" aria-labelledby="delivery-preview-title">
          <div class="section-heading"><div><span class="eyebrow">Revisão explícita</span><h3 id="delivery-preview-title">Prévia do envio</h3></div><span v-if="deliveryPreview" class="status-chip">{{ deliveryPreview.mode === 'fake' ? 'Fake local' : 'Modo real' }}</span></div>
          <p class="form-intro">A prévia inclui o link individual do convite. Ela só aparece após sua solicitação e nunca é listada no histórico.</p>
          <div class="delivery-preview-controls">
            <label for="delivery-invitation">Convite pendente</label>
            <select id="delivery-invitation" v-model="deliveryInvitationId" :disabled="deliveryLoading || deliveryPreviewLoading || !eligibleDeliveryInvitations.length" @change="clearDeliveryPreview">
              <option value="">Selecione um convite elegível</option>
              <option v-for="item in eligibleDeliveryInvitations" :key="item.id" :value="item.id">{{ item.guestName }} · expira {{ new Date(item.expiresAt).toLocaleDateString('pt-BR') }}</option>
            </select>
            <p v-if="!deliveryLoading && !eligibleDeliveryInvitations.length" class="empty-inline">Não há convites pendentes, ativos e não expirados para este evento.</p>
            <button class="button quiet" type="button" :disabled="!deliveryInvitationId || deliveryLoading || deliveryPreviewLoading" @click="loadDeliveryPreview">{{ deliveryPreviewLoading ? 'Gerando prévia…' : 'Gerar prévia' }}</button>
          </div>
          <div v-if="deliveryPreview" class="delivery-preview-content" aria-live="polite">
            <div class="delivery-recipient-preview">
              <span class="guest-avatar" aria-hidden="true">{{ deliveryPreview.recipient.name.slice(0, 1).toUpperCase() }}</span>
              <div><small>Destinatário</small><strong>{{ deliveryPreview.recipient.name }}</strong><span>{{ deliveryPreview.recipient.phone }}</span></div>
            </div>
            <p v-if="deliveryPreview.recipient.whatsappConsent" class="form-message success" role="status">Consentimento para WhatsApp registrado no contato.</p>
            <p v-else class="form-message error" role="status">Sem consentimento atual para WhatsApp. Edite o contato e registre autorização antes de aprovar.</p>
            <p v-if="deliveryPreview.mode === 'fake'" class="form-message fake-mode-note" role="status"><strong>Fake local.</strong> A aprovação só cria trabalho simulado; nenhuma mensagem real será enviada.</p>
            <p v-else class="form-message error" role="status"><strong>Modo real detectado.</strong> A aprovação está desativada nesta interface. Nenhum envio real será iniciado.</p>
            <label for="delivery-preview-text">Texto que será enviado</label>
            <textarea id="delivery-preview-text" :value="deliveryPreview.text" readonly rows="5"></textarea>
            <label for="delivery-preview-link">Link individual do convite</label>
            <input id="delivery-preview-link" :value="deliveryPreview.link" readonly @focus="($event.target as HTMLInputElement).select()">
            <details class="delivery-artwork-preview">
              <summary>Prévia visual do convite publicado</summary>
              <div class="preview-stage">
                <component :is="deliveryPreview.template.layout === 'editorial' ? EditorialTemplate : ClassicTemplate" :template="deliveryPreview.template" :values="deliveryPreview.renderData" :image-url="deliveryPreviewImageUrl" :date-label="deliveryPreviewDateLabel" :deadline-label="deliveryPreviewDeadlineLabel" />
              </div>
            </details>
            <div v-if="deliveryPreview.mode === 'fake' && deliveryPreview.recipient.whatsappConsent" class="delivery-approval">
              <p v-if="selectedInvitationHasDelivery" class="form-message success" role="status">Este convite já possui uma solicitação. A API mantém uma solicitação única por versão.</p>
              <label v-else class="check-field" for="delivery-approval-confirm"><input id="delivery-approval-confirm" v-model="deliveryApprovalConfirmed" type="checkbox"> Aprovo a simulação deste envio para {{ deliveryPreview.recipient.name }} após revisar o texto e o link.</label>
              <button v-if="!selectedInvitationHasDelivery" class="button primary" type="button" :disabled="!deliveryApprovalConfirmed || deliveryApproving" @click="approveFakeDelivery">{{ deliveryApproving ? 'Registrando aprovação…' : 'Aprovar envio simulado' }}</button>
            </div>
          </div>
        </section>

        <section class="panel delivery-history" aria-labelledby="delivery-history-title">
          <div class="section-heading"><div><span class="eyebrow">Rastreamento</span><h3 id="delivery-history-title">Solicitações e tentativas</h3></div><button class="button quiet" type="button" :disabled="deliveryLoading" @click="clearDeliveryPreview(); loadDeliveryData()">{{ deliveryLoading ? 'Atualizando…' : 'Atualizar lista' }}</button></div>
          <p class="form-intro">“Aceito pelo provedor” confirma apenas aceitação técnica. Não confirma entrega nem leitura no WhatsApp.</p>
          <div v-if="deliveryLoading" class="empty-inline" role="status">Carregando solicitações…</div>
          <div v-else-if="deliveryRows.length" class="delivery-records">
            <article v-for="item in deliveryRows" :key="item.id" class="delivery-record">
              <div class="delivery-record-heading"><strong>{{ item.guestName }}</strong><span class="status-chip">{{ deliveryStatusLabel(item.status) }}</span></div>
              <dl class="delivery-parts"><div><dt>Mídia</dt><dd>{{ deliveryPartStatusLabel(item.media.status) }}</dd><small v-if="item.media.messageId">ID do provedor: {{ item.media.messageId }}</small></div><div><dt>Texto</dt><dd>{{ deliveryPartStatusLabel(item.text.status) }}</dd><small v-if="item.text.messageId">ID do provedor: {{ item.text.messageId }}</small></div><div><dt>Tentativas</dt><dd>{{ item.attempts.length }}</dd></div></dl>
              <ul v-if="item.attempts.length" class="delivery-attempt-list" aria-label="Detalhes das tentativas"><li v-for="(attempt, index) in item.attempts" :key="`${attempt.part}-${index}-${attempt.startedAt}`">{{ attempt.part === 'media' ? 'Mídia' : 'Texto' }} · {{ attempt.outcome }} · {{ new Date(attempt.startedAt).toLocaleString('pt-BR') }}<template v-if="attempt.providerCode"> · HTTP {{ attempt.providerCode }}</template></li></ul>
              <small>Solicitado {{ new Date(item.createdAt).toLocaleString('pt-BR') }} · Atualizado {{ new Date(item.updatedAt).toLocaleString('pt-BR') }}</small>
            </article>
          </div>
          <div v-else-if="!deliveryLoading" class="empty-state"><span class="empty-mark" aria-hidden="true">✳</span><h3>Nenhuma solicitação registrada</h3><p>A prévia não cria envios. Aprove a simulação após revisar conteúdo e destinatário.</p></div>
        </section>
      </section>

      <section v-else-if="activeArea === 'automations'" class="invitation-shell automation-shell" aria-labelledby="automation-title">
        <header class="template-page-heading">
          <div><span class="eyebrow">Regras e planejamento</span><h2 id="automation-title">Automações · {{ automationEvent?.name || 'Evento' }}</h2><p>{{ selectedOrganization?.name }} · Ativação cria tarefas sujeitas a nova checagem de elegibilidade.</p></div>
          <button class="button quiet" type="button" @click="closeAutomationPanel">Voltar aos eventos</button>
        </header>
        <p v-if="automationError" class="form-message error" role="alert">{{ automationError }}</p>
        <p v-if="automationNotice" class="form-message success" role="status">{{ automationNotice }}</p>
        <p v-if="automationMode === 'fake'" class="form-message fake-mode-note" role="status"><strong>Modo fake local.</strong> As tarefas usam o adaptador simulado. Planejamento não confirma aceitação ou entrega.</p>
        <p v-else-if="automationMode === 'real'" class="form-message error" role="status"><strong>Modo real detectado.</strong> Esta tela não ativa automações reais antes da revisão final de envios externos.</p>
        <p v-else class="form-message" role="status">Modo do provedor indisponível. A prévia não envia mensagens; ativação fica bloqueada até confirmar o modo fake local.</p>

        <section class="panel automation-panel" aria-labelledby="automation-rules-title">
          <div class="section-heading"><div><span class="eyebrow">Configuração por evento</span><h3 id="automation-rules-title">Regras</h3></div><span v-if="automationRule" class="status-chip" :class="automationRuleActive ? 'automation-active' : ''">{{ automationRuleActive ? 'Ativa nesta revisão' : automationRule ? `Rascunho · revisão ${automationRule.revision}` : 'Nova regra' }}</span></div>
          <div class="automation-type-list" role="group" aria-label="Tipo de automação">
            <button v-for="option in automationTypeOptions" :key="option.value" class="automation-type-button" type="button" :aria-pressed="automationType === option.value" :disabled="automationLoading || (automationFormDirty && automationType !== option.value)" @click="setAutomationType(option.value)">{{ option.label }}</button>
          </div>
          <p v-if="automationType === 'admin_summary'" class="publication-note">O resumo exige um número administrativo configurado. Sem ele, a prévia informa que a regra não está disponível.</p>
          <div v-if="automationLoading" class="empty-inline" role="status">Carregando regras e histórico…</div>
          <form v-else class="automation-form" @submit.prevent="saveAutomationRule">
            <label class="check-field" for="automation-enabled"><input id="automation-enabled" v-model="automationForm.enabled" type="checkbox"> Permitir planejamento desta regra após ativação explícita</label>
            <div class="automation-fields">
              <div><label for="automation-audience">Público</label><select id="automation-audience" v-model="automationForm.audience"><option v-for="audience in automationAvailableAudiences" :key="audience" :value="audience">{{ automationAudienceLabel(audience) }}</option></select></div>
              <div><label for="automation-anchor">Horário relativo a</label><select id="automation-anchor" v-model="automationForm.anchor"><option v-for="anchor in automationAvailableAnchors" :key="anchor" :value="anchor">{{ automationAnchorLabel(anchor) }}</option></select></div>
              <div v-if="automationUsesFixedTime"><label for="automation-at">Data e hora com offset</label><input id="automation-at" v-model.trim="automationForm.at" type="text" required maxlength="40" pattern="^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$" placeholder="2026-11-12T18:30:00-04:00"><small>Use ISO 8601 com offset explícito. Fuso do evento: {{ timeZoneLabel(automationEvent?.timeZone) }}.</small></div>
              <div><label for="automation-offset">Deslocamento em minutos</label><input id="automation-offset" v-model.number="automationForm.offsetMinutes" type="number" min="-43200" max="43200" step="1" required><small>Negativo = antes; positivo = depois do horário escolhido.</small></div>
              <div><label for="automation-max">Máximo de execuções</label><input id="automation-max" v-model.number="automationForm.maxExecutions" type="number" min="1" max="10" step="1" required></div>
              <div><label for="automation-grace">Tolerância para atraso (minutos)</label><input id="automation-grace" v-model.number="automationForm.graceMinutes" type="number" min="5" max="1440" step="1" required><small>Jobs atrasados além desta janela são suprimidos.</small></div>
            </div>
            <label for="automation-text">Texto da mensagem</label>
            <textarea id="automation-text" v-model.trim="automationForm.text" required maxlength="1000" rows="5"></textarea>
            <details class="automation-token-help"><summary>Variáveis de texto disponíveis</summary><p>Copie os tokens exatos. HTML e variáveis desconhecidas serão rejeitados.</p><ul><li v-for="token in automationTextTokens" :key="token"><code>{{ token }}</code></li></ul></details>
            <p class="form-intro">O serviço revalida resposta, prazo, opt-out, consentimento, evento, conexão e limite no momento da execução. Respostas RSVP continuam separadas das mensagens.</p>
            <div class="automation-actions">
              <button class="button primary" type="submit" :disabled="automationSaving || automationLoading">{{ automationSaving ? 'Salvando…' : 'Salvar regra' }}</button>
              <button v-if="automationFormDirty" class="button quiet" type="button" :disabled="automationSaving" @click="setAutomationType(automationType)">Descartar alterações</button>
              <button class="button quiet" type="button" :disabled="automationFormDirty || !automationRule || automationPreviewLoading || !automationForm.enabled" @click="previewAutomation">{{ automationPreviewLoading ? 'Calculando…' : 'Gerar prévia de destinatários' }}</button>
            </div>
          </form>
          <section v-if="automationPreview" class="automation-preview" aria-labelledby="automation-preview-title" aria-live="polite">
            <div class="section-heading"><div><span class="eyebrow">Revisão antes de ativar</span><h4 id="automation-preview-title">Prévia de destinatários</h4></div><span class="count-pill">{{ automationPreview.recipientCount }} elegíveis</span></div>
            <p>Esta prévia é da revisão {{ automationPreviewRevision }}. Tarefas ainda podem ser suprimidas se a situação do convite mudar.</p>
            <p v-if="automationPreview.deliveryContent?.kind === 'official_template'" class="form-intro">Envio oficial: template aprovado {{ automationPreview.deliveryContent.name }} ({{ automationPreview.deliveryContent.language }}). O texto livre da regra não será enviado.</p>
            <p v-else-if="automationPreview.deliveryContent?.kind === 'free_text'" class="form-intro">O texto da regra será usado no envio.</p>
            <div v-if="automationPreview.sample.length" class="automation-samples">
              <article v-for="sample in automationPreview.sample" :key="sample.invitationId" class="automation-sample">
                <div><strong>{{ sample.guestName }}</strong><span>{{ sample.phone }} · {{ automationResponseLabel(sample.responseStatus) }}</span></div>
                <span class="status-chip" :class="sample.eligible ? 'automation-active' : 'automation-ineligible'">{{ sample.eligible ? 'Elegível agora' : automationSampleReason(sample.reason || 'Inelegível') }}</span>
                <small>Planejado para {{ new Date(sample.scheduledAt).toLocaleString('pt-BR', { timeZone: automationEvent?.timeZone }) }}</small>
              </article>
            </div>
            <p v-else class="empty-inline">Nenhum destinatário elegível nesta prévia.</p>
            <button class="button primary" type="button" :disabled="automationMode !== 'fake' || automationActivating || automationFormDirty || !automationForm.enabled || !automationRule || automationPreviewRevision !== automationRule.revision || !automationPreview.recipientCount" @click="activateAutomation">{{ automationActivating ? 'Ativando…' : 'Ativar regra e planejar tarefas' }}</button>
            <p class="form-intro">A ativação planeja tarefas. O worker verifica tudo novamente. Aceitação do provedor não confirma entrega.</p>
          </section>
        </section>

        <section class="panel automation-history" aria-labelledby="automation-history-title">
          <div class="section-heading"><div><span class="eyebrow">Auditoria</span><h3 id="automation-history-title">Histórico e diagnóstico</h3></div><button class="button quiet" type="button" :disabled="automationLoading" @click="loadAutomationJobs">{{ automationLoading ? 'Atualizando…' : 'Atualizar histórico' }}</button></div>
          <p class="form-intro">Cada tarefa guarda estado operacional. O painel não afirma entrega ou leitura no WhatsApp.</p>
          <div v-if="automationLoading" class="empty-inline" role="status">Carregando tarefas…</div>
          <div v-else-if="automationJobs.length" class="automation-jobs">
            <article v-for="job in automationJobs" :key="job.id" class="automation-job">
              <div class="automation-job-heading"><div><strong>{{ job.guestName || job.recipientPhone || 'Resumo administrativo' }}</strong><span>{{ automationJobTypeLabel(job) }} · {{ job.recipientPhone }}</span></div><span class="status-chip" :class="job.status === 'suppressed' ? 'automation-ineligible' : job.status === 'accepted' ? 'automation-active' : ''">{{ automationJobStatusLabel(job.status) }}</span></div>
              <dl><div><dt>Agendado</dt><dd>{{ new Date(job.scheduledAt).toLocaleString('pt-BR', { timeZone: automationEvent?.timeZone }) }}</dd></div><div><dt>Atualizado</dt><dd>{{ new Date(job.updatedAt).toLocaleString('pt-BR', { timeZone: automationEvent?.timeZone }) }}</dd></div></dl>
              <p v-if="job.suppressionReason" class="form-message error" role="status">Diagnóstico: {{ automationSampleReason(job.suppressionReason) }}</p>
            </article>
          </div>
          <p v-else class="empty-inline">Nenhuma tarefa registrada para este evento.</p>
        </section>

        <section class="panel automation-suppression" aria-labelledby="automation-suppression-title">
          <div><span class="eyebrow">Ação administrativa</span><h3 id="automation-suppression-title">Suprimir contato</h3><p class="form-intro">Impede novas notificações para o contato até revisão autorizada. A supressão não altera RSVP.</p></div>
          <form class="automation-suppression-form" @submit.prevent="suppressAutomationGuest">
            <div class="automation-suppression-search"><label for="automation-guest-search">Buscar convidado por nome ou telefone</label><div class="search-row"><input id="automation-guest-search" v-model.trim="automationGuestQuery" type="search" maxlength="100"><button class="button quiet" type="button" @click="searchAutomationGuests">Buscar</button></div></div>
            <label for="automation-guest">Contato</label><select id="automation-guest" v-model="automationGuestId" :disabled="!automationGuests.length"><option value="">{{ automationGuests.length ? 'Selecione um contato' : 'Busque um contato primeiro' }}</option><option v-for="guest in automationGuests" :key="guest.id" :value="guest.id">{{ guest.name }} · {{ guest.phone }}</option></select>
            <label for="automation-suppression-reason">Motivo da supressão</label><textarea id="automation-suppression-reason" v-model.trim="automationSuppressionReason" required maxlength="200" rows="2" placeholder="Ex.: solicitação recebida por telefone"></textarea>
            <label class="check-field" for="automation-suppression-confirm"><input id="automation-suppression-confirm" v-model="automationSuppressionConfirmed" type="checkbox"> Confirmo bloquear futuras notificações deste contato.</label>
            <button class="button quiet danger-quiet" type="submit" :disabled="automationSuppressing || !automationGuestId || !automationSuppressionReason.trim() || !automationSuppressionConfirmed">{{ automationSuppressing ? 'Registrando…' : 'Registrar supressão manual' }}</button>
          </form>
        </section>
      </section>

      <section v-else-if="activeArea === 'invitations'" class="invitation-shell" aria-labelledby="invitation-page-title">
        <header class="template-page-heading">
          <div><span class="eyebrow">Emissão individual</span><h2 id="invitation-page-title">{{ invitationEvent?.name || 'Convites do evento' }}</h2><p>{{ selectedOrganization?.name }} · Convite publicado v{{ invitationEvent?.publishedTemplateVersion }}.</p></div>
          <button class="button quiet" type="button" @click="activeArea = 'events'">Voltar aos eventos</button>
        </header>
        <p v-if="invitationError" class="form-message error" role="alert">{{ invitationError }}</p>
        <p v-if="invitationNotice" class="form-message success" role="status">{{ invitationNotice }}</p>
        <section v-if="invitationEvent?.publishedTemplateVersion" class="panel invitation-issuer" aria-labelledby="issuer-title">
          <div><span class="eyebrow">Novo convite</span><h3 id="issuer-title">Escolha o destinatário</h3><p class="form-intro">O link não é enviado automaticamente. Você poderá revelá-lo e copiá-lo depois da emissão.</p></div>
          <div class="issuer-fields">
            <form class="search-row invitation-search" role="search" @submit.prevent="searchInvitationGuests"><label class="visually-hidden" for="invitation-guest-search">Buscar destinatário</label><input id="invitation-guest-search" v-model="invitationGuestQuery" type="search" maxlength="100" placeholder="Buscar contato por nome ou telefone"><button class="button quiet" type="submit">Buscar</button></form>
            <label for="invitation-guest">Convidado</label>
            <select id="invitation-guest" v-model="invitationGuestId" :disabled="invitationLoading || !invitationGuests.length">
              <option value="" disabled>Selecione um contato</option>
              <option v-for="guest in invitationGuests" :key="guest.id" :value="guest.id">{{ guest.name }} · {{ guest.phone }}</option>
            </select>
            <div v-if="selectedInvitationGuest" class="recipient-preview" aria-live="polite">
              <span class="guest-avatar" aria-hidden="true">{{ selectedInvitationGuest.name.slice(0, 1).toUpperCase() }}</span>
              <span><small>Prévia do destinatário</small><strong>{{ selectedInvitationGuest.name }}</strong><span>{{ selectedInvitationGuest.email || selectedInvitationGuest.phone }}</span></span>
            </div>
            <p v-else-if="!invitationLoading" class="empty-inline">Cadastre um contato antes de emitir um convite.</p>
            <div v-if="invitationGuestTotal > 100 || invitationGuestSearch" class="pagination" aria-label="Paginação dos destinatários"><span>Página {{ invitationGuestPage }} de {{ invitationGuestPages }} · {{ invitationGuestTotal }} contatos</span><div><button class="button quiet" type="button" :disabled="invitationGuestPage <= 1" @click="changeInvitationGuestPage(invitationGuestPage - 1)">Anterior</button><button class="button quiet" type="button" :disabled="invitationGuestPage >= invitationGuestPages" @click="changeInvitationGuestPage(invitationGuestPage + 1)">Próxima</button></div></div>
            <button class="button primary" type="button" :disabled="invitationSaving || invitationLoading || !invitationGuestId" @click="issueInvitation">{{ invitationSaving ? 'Emitindo…' : 'Emitir convite' }}</button>
          </div>
        </section>
        <section v-else class="panel invitation-issuer"><div><span class="eyebrow">Convite não publicado</span><h3>Publique o modelo para continuar</h3><p>Convites só podem ser emitidos para eventos com um modelo publicado.</p></div><button class="button quiet" type="button" @click="invitationEvent && openTemplateEditor(invitationEvent)">Editar e publicar convite</button></section>
        <section class="panel invitation-list" aria-labelledby="invitation-list-title">
          <div class="section-heading"><div><span class="eyebrow">Acompanhamento</span><h3 id="invitation-list-title">Convites emitidos</h3></div><button class="button quiet" type="button" :disabled="invitationLoading" @click="loadInvitations">Atualizar</button></div>
          <EventReportPanel
            v-if="selectedOrganizationId && invitationEvent"
            :organization-id="selectedOrganizationId"
            :event-id="invitationEvent.id"
          />
          <div v-if="invitationLoading" class="empty-inline" role="status">Carregando convites…</div>
          <div v-else-if="invitationItems.length" class="invitation-records">
            <article v-for="item in invitationItems" :key="item.id" class="invitation-record">
              <div class="invitation-record-heading"><div><strong>{{ item.guestName }}</strong><span class="status-chip" :class="{ revoked: item.revokedAt }">{{ invitationStatus(item) }}</span></div><small>Modelo v{{ item.templateVersion }} · criada {{ new Date(item.createdAt).toLocaleString('pt-BR') }}</small></div>
              <dl class="invitation-meta"><div><dt>Prazo de resposta</dt><dd>{{ eventDateTimeLabel(invitationEvent?.rsvpDeadline, invitationEvent?.timeZone) }}</dd></div><div><dt>Validade do link</dt><dd>{{ eventDateTimeLabel(item.expiresAt, invitationEvent?.timeZone) }}</dd></div><div><dt>Resposta</dt><dd>{{ item.respondedAt ? new Date(item.respondedAt).toLocaleString('pt-BR', { timeZone: invitationEvent?.timeZone }) : 'Ainda sem resposta' }}</dd></div><div><dt>Acompanhantes</dt><dd>{{ companionSummary(item) }}</dd></div></dl>
              <div v-if="revealedInvitation?.id === item.id" class="revealed-link"><label :for="`invitation-link-${item.id}`">Link ativo</label><input :id="`invitation-link-${item.id}`" :value="revealedInvitation.link" readonly @focus="($event.target as HTMLInputElement).select()"><button class="button quiet" type="button" @click="copyInvitationLink">Copiar link</button></div>
              <div class="invitation-actions">
                <button v-if="!item.revokedAt" class="button quiet" type="button" @click="revealInvitationLink(item)">{{ revealedInvitation?.id === item.id ? 'Atualizar link exibido' : 'Revelar link' }}</button>
                <button v-if="!item.revokedAt" class="button quiet" type="button" :disabled="invitationSaving" @click="invitationConfirmation = { id: item.id, action: 'rotate' }">Renovar link</button>
                <button v-if="!item.revokedAt" class="button danger-quiet" type="button" :disabled="invitationSaving" @click="invitationConfirmation = { id: item.id, action: 'revoke' }">Revogar</button>
              </div>
              <div v-if="invitationConfirmation?.id === item.id" class="inline-confirmation" role="group" :aria-label="invitationConfirmation.action === 'rotate' ? 'Confirmar renovação' : 'Confirmar revogação'">
                <span>{{ invitationConfirmation.action === 'rotate' ? 'O link atual deixará de funcionar. Renovar agora?' : 'O convidado perderá acesso pelo link. Revogar este convite?' }}</span>
                <button class="button primary" type="button" :disabled="invitationSaving" @click="confirmInvitationAction">{{ invitationSaving ? 'Processando…' : invitationConfirmation.action === 'rotate' ? 'Confirmar renovação' : 'Confirmar revogação' }}</button>
                <button class="button quiet" type="button" @click="invitationConfirmation = null">Cancelar</button>
              </div>
            </article>
          </div>
          <div v-else-if="!invitationLoading" class="empty-state"><span class="empty-mark" aria-hidden="true">✳</span><h3>Nenhum convite emitido</h3><p>Escolha um contato acima para criar o primeiro.</p></div>
        </section>
      </section>

      <section v-else-if="activeArea === 'template'" class="template-editor-shell" aria-labelledby="template-page-title">
        <header class="template-page-heading">
          <div><span class="eyebrow">Convite do evento</span><h2 id="template-page-title">{{ templateEvent?.name || 'Editar convite' }}</h2><p>{{ selectedOrganization?.name }} · Configuração segura, publicada por versão.</p></div>
          <button class="button quiet" type="button" @click="closeTemplateEditor">Voltar aos eventos</button>
        </header>
        <p v-if="templateError" class="form-message error" role="alert">{{ templateError }}</p>
        <p v-if="templateNotice" class="form-message success" role="status">{{ templateNotice }}</p>
        <div v-if="templateLoading" class="panel template-loading" role="status">Carregando o convite…</div>
        <div v-else class="template-workspace">
          <form class="panel template-editor" @submit.prevent="saveTemplateDraft">
            <div class="template-editor-heading"><div><span class="eyebrow">{{ viewingPublication ? `Versão publicada ${viewingPublication.version}` : 'Rascunho editável' }}</span><h3>{{ viewingPublication ? 'Snapshot imutável' : 'Personalize o convite' }}</h3></div><span v-if="publishedVersion" class="version-badge">Publicado v{{ publishedVersion }}</span></div>
            <div v-if="viewingPublication" class="publication-note" role="status">Esta versão é somente leitura. Alterações no rascunho não modificam o snapshot publicado.</div>
            <fieldset class="template-fields" :disabled="!!viewingPublication">
              <legend class="visually-hidden">Campos do convite</legend>
              <fieldset class="layout-options"><legend>Layout do convite</legend>
                <label class="layout-choice"><input v-model="templateForm.layout" type="radio" value="editorial"><span><strong>Editorial</strong><small>Tipografia expressiva e leitura em coluna.</small></span></label>
                <label class="layout-choice"><input v-model="templateForm.layout" type="radio" value="classic"><span><strong>Clássico</strong><small>Moldura delicada e composição central.</small></span></label>
              </fieldset>
              <label for="template-title">Título</label><input id="template-title" v-model.trim="templateForm.title" required maxlength="160">
              <label for="template-subtitle">Subtítulo</label><input id="template-subtitle" v-model.trim="templateForm.subtitle" required maxlength="300">
              <label for="template-body">{{ templateForm.imageAssetId ? 'Descrição acessível da imagem' : 'Mensagem' }}</label>
              <textarea id="template-body" v-model.trim="templateForm.body" required maxlength="3000" rows="5" :aria-describedby="templateForm.imageAssetId ? 'template-body-help' : undefined"></textarea>
              <p v-if="templateForm.imageAssetId" id="template-body-help" class="variable-help">Transcreva o texto essencial da arte para pessoas que usam leitores de tela.</p>
              <p class="variable-help">Variáveis disponíveis: <code v-for="variable in ['convidado.nome', 'evento.nome', 'evento.data', 'evento.horario', 'evento.fuso', 'evento.prazo_confirmacao', 'evento.local', 'convite.link', 'convite.limite_acompanhantes']" :key="variable" v-text="'{' + '{' + variable + '}' + '}'"></code>. A prévia usa dados de exemplo.</p>
              <div class="field-row"><div><label for="template-primary-button">Botão principal</label><input id="template-primary-button" v-model.trim="templateForm.primaryButtonText" required maxlength="80"></div><div><label for="template-secondary-button">Botão secundário</label><input id="template-secondary-button" v-model.trim="templateForm.secondaryButtonText" required maxlength="80"></div></div>
              <fieldset class="color-options"><legend>Cores</legend>
                <label for="template-background">Fundo<input id="template-background" v-model="templateForm.colors.background" type="color"></label>
                <label for="template-text-color">Texto<input id="template-text-color" v-model="templateForm.colors.text" type="color"></label>
                <label for="template-accent">Destaque<input id="template-accent" v-model="templateForm.colors.accent" type="color"></label>
              </fieldset>
              <div class="field-row"><div><label for="template-font">Fonte</label><select id="template-font" v-model="templateForm.font"><option value="serif">Serifada</option><option value="sans">Sem serifa</option></select></div><div><label for="template-alignment">Alinhamento</label><select id="template-alignment" v-model="templateForm.alignment"><option value="left">À esquerda</option><option value="center">Centralizado</option></select></div></div>
              <fieldset class="block-options"><legend>Informações no convite</legend>
                <label><input v-model="templateForm.blocks.date" type="checkbox"> Data e horário</label>
                <label><input v-model="templateForm.blocks.location" type="checkbox"> Local</label>
                <label><input v-model="templateForm.blocks.rsvp" type="checkbox"> Prazo de confirmação</label>
              </fieldset>
              <div class="image-field"><label for="template-image">Imagem opcional</label><input id="template-image" type="file" accept="image/png,image/jpeg,image/webp" :disabled="templateSaving" @change="uploadTemplateImage"><small>PNG, JPEG ou WebP, até 5 MiB. A imagem é normalizada no servidor.</small><div v-if="templateForm.imageAssetId" class="image-status"><span>Imagem vinculada ao rascunho.</span><button class="text-button" type="button" @click="removeTemplateImage">Remover do convite</button></div></div>
            </fieldset>
            <EventMessageEditor v-model="templateForm.message" :preview="messagePreview" :read-only="!!viewingPublication" />
            <div class="template-actions">
              <button v-if="viewingPublication" class="button quiet" type="button" @click="editCurrentDraft">Voltar ao rascunho</button>
              <button v-else class="button quiet" type="submit" :disabled="templateSaving || templatePublishing">{{ templateSaving ? 'Salvando…' : 'Salvar rascunho' }}</button>
              <button v-if="!viewingPublication" class="button primary" type="button" :disabled="templateSaving || templatePublishing" @click="publishTemplate">{{ templatePublishing ? 'Publicando…' : publishedVersion ? 'Publicar nova versão' : 'Publicar convite' }}</button>
            </div>
            <div v-if="publishedVersion && !viewingPublication" class="template-actions"><button v-for="version in publishedVersion" :key="version" class="text-button version-link" type="button" @click="viewPublishedVersion(version)">Ver snapshot publicado v{{ version }}</button></div>
          </form>

          <section class="panel preview-panel" aria-labelledby="preview-title">
            <div class="preview-heading"><div><span class="eyebrow">Aparência</span><h3 id="preview-title">Prévia do convite</h3></div><div class="preview-switch" role="group" aria-label="Tamanho da prévia"><button type="button" :aria-pressed="previewSize === 'desktop'" @click="previewSize = 'desktop'">Desktop</button><button type="button" :aria-pressed="previewSize === 'mobile'" @click="previewSize = 'mobile'">Celular</button></div></div>
            <p class="preview-example">Dados de exemplo; variáveis aparecem como texto seguro.</p>
            <div class="preview-stage" :class="`preview-${previewSize}`">
              <component :is="displayedTemplate.layout === 'editorial' ? EditorialTemplate : ClassicTemplate" :template="displayedTemplate" :values="previewValues" :image-url="displayedImageUrl" :date-label="resolvedPreview.dateLabel" :deadline-label="resolvedPreview.deadlineLabel" />
            </div>
          </section>
        </div>
      </section>

      <section v-else-if="activeArea === 'guests'" class="guest-layout">
        <DesignGuests :guests="guests.map(guest => ({ ...guest, status: guestRsvpStatusById[guest.id] }))" :page="guestPage" :page-size="guestPageSize" :total="guestTotal" :all-total="dashboardGuestTotal" :query="guestQuery" :active-tag="guestTag" :status-event-name="guestRsvpEvent?.name" :rsvp-events="guestRsvpEvents" :rsvp-event-id="guestRsvpEventId" :rsvp-loading="guestRsvpLoading" :rsvp-error="guestRsvpError" :loading="guestLoading" @search="searchDesignGuests" @edit="editDesignGuest" @page="changeGuestPage" @pagesize="changeGuestPageSize" @rsvpevent="selectGuestRsvpEvent" @new="focusGuestTool('guest-name')" @import="focusGuestTool('csv-file')" />

        <div class="guest-tools">
          <form class="panel data-form" @submit.prevent="saveGuest">
            <div><span class="eyebrow">Cadastro</span><h2>{{ guestTitle }}</h2><p class="form-intro">Use telefone internacional no formato +DDI e número.</p></div>
            <label for="guest-name">Nome <span aria-hidden="true">*</span></label><input id="guest-name" v-model.trim="guestForm.name" required maxlength="120">
            <label for="guest-phone">Telefone internacional <span aria-hidden="true">*</span></label><input id="guest-phone" v-model.trim="guestForm.phone" type="tel" required pattern="\+[1-9][0-9]{7,14}" placeholder="+5567999999999" autocomplete="tel">
            <label class="check-field" for="guest-whatsapp-consent"><input id="guest-whatsapp-consent" v-model="guestForm.whatsappConsent" type="checkbox"> Este contato autorizou receber convites iniciais por WhatsApp</label>
            <template v-if="guestForm.whatsappConsent">
              <label for="guest-authorization-source">Origem da autorização <span aria-hidden="true">*</span></label>
              <input id="guest-authorization-source" v-model.trim="guestForm.authorizationSource" required minlength="5" maxlength="300" placeholder="Ex.: formulário presencial assinado em 15/10/2026">
            </template>
            <label for="guest-email">E-mail</label><input id="guest-email" v-model.trim="guestForm.email" type="email" maxlength="254" autocomplete="email">
            <label for="guest-tags">Etiquetas</label><input id="guest-tags" v-model.trim="guestForm.tags" maxlength="800" placeholder="família, amigos">
            <label for="guest-notes">Notas internas</label><textarea id="guest-notes" v-model="guestForm.notes" maxlength="2000" rows="2"></textarea>
            <div class="form-actions"><button v-if="editingGuestId" class="button quiet" type="button" @click="resetGuestForm">Cancelar edição</button><button class="button primary" type="submit" :disabled="saving">{{ saving ? 'Salvando…' : editingGuestId ? 'Salvar contato' : 'Criar contato' }}</button></div>
          </form>

          <DesignCsvImport :rows="csvRows" :name="csvName" :accepted-rows="acceptedRows" :importing="importing" @choose="chooseCsv" @accept="setAccepted" @import="importCsv" />
        </div>
      </section>

      <CampaignWorkspace
        v-if="campaignEvent"
        v-show="activeArea === 'campaigns'"
        :key="`${selectedOrganizationId}:${campaignEvent.id}`"
        :organization-id="selectedOrganizationId"
        :csrf-token="csrfToken"
        :event="events.find(item => item.id === campaignEvent?.id) || campaignEvent"
        :initial-step="campaignStep"
        :active="activeArea === 'campaigns'"
        @step="campaignStep = $event"
        @close="activeArea = 'events'"
        @template="openTemplateEditor(campaignEvent)"
        @guests="activeArea = 'guests'"
        @connection="openEvolutionArea"
      />

      <template #assistant>
        <AssistantChat
          v-if="selectedOrganizationId"
          :organization-id="selectedOrganizationId"
          :csrf-token="csrfToken"
          :events="events"
          @navigation="handleAssistantNavigation"
        />
      </template>
    </DesignShell>
  </div>
</template>

<style scoped lang="sass">
.invitation-shell
  display: grid
  gap: 18px
  margin-top: 22px

.automation-panel, .automation-history, .automation-suppression
  padding: 24px

.automation-type-list
  display: flex
  flex-wrap: wrap
  gap: 7px
  margin: 16px 0

.automation-type-button
  min-height: 36px
  padding: 7px 11px
  color: var(--muted, #a8a4ad)
  background: var(--surface-soft, #202224)
  border: 1px solid var(--line, #343539)
  border-radius: 8px
  cursor: pointer
  font: inherit
  font-size: 12px
  font-weight: 650

  &[aria-pressed="true"]
    color: #f2f1d0
    background: #202224
    border-color: #f2f1d0

  &:focus-visible
    outline: 3px solid rgba(169, 123, 88, .35)
    outline-offset: 2px

.automation-form, .automation-suppression-form
  display: grid
  gap: 12px

  > label:not(.check-field), .automation-fields label, .automation-suppression-search > label
    color: #f3f1f5
    font-size: 12px
    font-weight: 700

  input:not([type="checkbox"]), textarea, select
    width: 100%
    min-height: 40px
    padding: 9px 11px
    color: #f3f1f5
    background: #171819
    border: 1px solid #343539
    border-radius: 7px
    font: inherit
    font-size: 13px

  textarea
    resize: vertical

  input:focus, textarea:focus, select:focus
    border-color: #f2f1d0

  small
    display: block
    margin-top: 5px
    color: var(--muted, #a8a4ad)
    font-size: 11px
    line-height: 1.45

.automation-fields
  display: grid
  grid-template-columns: repeat(3, minmax(0, 1fr))
  gap: 12px

  > div
    display: grid
    align-content: start
    gap: 6px

.automation-actions
  display: flex
  flex-wrap: wrap
  gap: 8px

.automation-preview
  display: grid
  gap: 12px
  margin-top: 20px
  padding: 18px
  background: #202224
  border: 1px solid #343539
  border-radius: 12px

  h4
    margin: 6px 0 0
    font-family: Inter, ui-sans-serif, system-ui, sans-serif
    font-size: 23px
    font-weight: 400

  > p
    margin: 0
    color: var(--muted, #a8a4ad)
    font-size: 12px

.automation-samples, .automation-jobs
  display: grid
  gap: 9px

.automation-sample, .automation-job
  display: grid
  gap: 8px
  padding: 13px
  background: #171819
  border: 1px solid var(--line, #343539)
  border-radius: 10px

.automation-sample
  grid-template-columns: minmax(0, 1fr) auto

  > div
    display: grid
    gap: 3px

  > div span, > small
    color: var(--muted, #a8a4ad)
    font-size: 11px

  > small
    grid-column: 1 / -1

.automation-active
  color: #a8e0bf
  background: #1b2922

.automation-ineligible
  color: #e89990
  background: #2b1d1d

.automation-job-heading
  display: flex
  align-items: flex-start
  justify-content: space-between
  gap: 12px

  > div
    display: grid
    gap: 3px

  > div span
    color: var(--muted, #a8a4ad)
    font-size: 11px

.automation-job dl
  display: grid
  grid-template-columns: repeat(2, minmax(0, 1fr))
  gap: 8px
  margin: 0

  dt
    color: var(--muted, #a8a4ad)
    font-size: 10px

  dd
    margin: 3px 0 0
    font-size: 12px

.automation-job .form-message
  margin: 0

.automation-suppression-form
  margin-top: 15px

.automation-suppression-search
  display: grid
  gap: 7px

.automation-suppression .search-row
  margin: 0

.automation-suppression .search-row input
  flex: 1

.automation-token-help
  padding: 10px 12px
  background: #202224
  border-radius: 8px

  summary
    color: #f2f1d0
    cursor: pointer
    font-size: 12px
    font-weight: 700

  p
    color: var(--muted, #a8a4ad)
    font-size: 11px

  ul
    display: flex
    flex-wrap: wrap
    gap: 6px
    margin: 8px 0 0
    padding: 0
    list-style: none

  li
    padding: 4px 6px
    background: #171819
    border-radius: 5px

  code
    color: #f2f1d0
    font-size: 10px

.published-event-actions
  display: flex
  flex-wrap: wrap
  gap: 7px

.event-revision-form
  display: grid
  gap: 10px
  grid-column: 1 / -1
  padding: 16px
  background: #202224
  border: 1px solid var(--line, #343539)
  border-radius: 10px

  h4
    margin: 5px 0
    font-family: Inter, ui-sans-serif, system-ui, sans-serif
    font-size: 21px
    font-weight: 400

  p, small
    color: var(--muted, #a8a4ad)
    font-size: 11px

  input, textarea
    width: 100%
    min-height: 39px
    padding: 8px 10px
    color: #f3f1f5
    background: #171819
    border: 1px solid #343539
    border-radius: 7px
    font: inherit
    font-size: 12px

  label:not(.check-field)
    color: #f3f1f5
    font-size: 11px
    font-weight: 700

.published-event-actions + .event-revision-form
  margin-top: 5px

.cancellation-confirmation
  border-color: #ad6f6c
  background: #2b1d1d

.automation-shell .template-page-heading
  margin-bottom: 0

.invitation-issuer
  display: grid
  grid-template-columns: minmax(220px, .8fr) minmax(280px, 1.2fr)
  gap: 24px
  align-items: start
  padding: 24px

.issuer-fields
  display: grid
  gap: 10px

.recipient-preview
  display: flex
  align-items: center
  gap: 12px
  padding: 14px
  border: 1px solid var(--line, #343539)
  border-radius: 12px
  background: var(--surface-soft, #202224)

  > span:last-child
    display: grid
    gap: 3px

.recipient-preview small, .invitation-record small
  color: var(--muted, #a8a4ad)

.invitation-list
  padding: 24px

.invitation-totals
  display: grid
  grid-template-columns: repeat(5, minmax(0, 1fr))
  gap: 10px
  margin: 18px 0

  > div
    padding: 12px
    border: 1px solid var(--line, #343539)
    border-radius: 10px

  dt
    color: var(--muted, #a8a4ad)
    font-size: .82rem

  dd
    margin: 5px 0 0
    font-size: 1.35rem
    font-weight: 650

.invitation-records
  display: grid
  gap: 12px

.invitation-record
  display: grid
  gap: 13px
  padding: 18px
  border: 1px solid var(--line, #343539)
  border-radius: 14px

.invitation-record-heading
  display: flex
  justify-content: space-between
  gap: 12px

  > div
    display: flex
    align-items: center
    gap: 10px

.invitation-meta
  display: grid
  grid-template-columns: repeat(3, minmax(0, 1fr))
  gap: 12px
  margin: 0

  dt
    color: var(--muted, #a8a4ad)
    font-size: .8rem

  dd
    margin: 4px 0 0

.invitation-actions, .revealed-link, .inline-confirmation
  display: flex
  flex-wrap: wrap
  align-items: center
  gap: 9px

.revealed-link
  padding: 12px
  border-radius: 10px
  background: var(--surface-soft, #202224)

  input
    min-width: min(100%, 300px)
    flex: 1

.inline-confirmation
  justify-content: flex-start
  padding: 12px
  border: 1px solid var(--line, #343539)
  border-radius: 10px

.danger-quiet
  color: #e89990

.status-chip.revoked
  color: #e89990

.empty-inline
  color: var(--muted, #a8a4ad)

.template-editor-shell
  margin-top: 22px

.template-page-heading
  display: flex
  align-items: center
  justify-content: space-between
  gap: 18px
  margin-bottom: 18px

  h2
    margin: 7px 0 4px
    font-family: Inter, ui-sans-serif, system-ui, sans-serif
    font-size: 32px
    font-weight: 400
    letter-spacing: -.035em

  p
    margin: 0
    color: #a8a4ad
    font-size: 13px

.template-workspace
  display: grid
  grid-template-columns: minmax(370px, .95fr) minmax(0, 1.05fr)
  align-items: start
  gap: 18px
  margin-top: 15px

.template-editor, .preview-panel
  padding: 23px

.template-editor
  display: grid
  gap: 14px

  > label, .template-fields > label
    color: #f3f1f5
    font-size: 12px
    font-weight: 700

  input:not([type="radio"]):not([type="checkbox"]):not([type="color"]):not([type="file"]), textarea, select
    width: 100%
    min-height: 40px
    padding: 9px 11px
    color: #f3f1f5
    background: #171819
    border: 1px solid #343539
    border-radius: 7px
    font: inherit
    font-size: 13px

  textarea
    resize: vertical

  input:focus, textarea:focus, select:focus
    border-color: #f2f1d0

.template-editor-heading, .preview-heading
  display: flex
  align-items: center
  justify-content: space-between
  gap: 12px

  h3
    margin: 6px 0 0
    font-family: Inter, ui-sans-serif, system-ui, sans-serif
    font-size: 24px
    font-weight: 400

.version-badge
  padding: 6px 10px
  color: #a8e0bf
  background: #1b2922
  border-radius: 999px
  font-size: 11px
  font-weight: 750
  white-space: nowrap

.template-fields
  display: grid
  gap: 9px
  min-width: 0
  margin: 0
  padding: 0
  border: 0

.layout-options, .color-options, .block-options
  display: grid
  gap: 8px
  min-width: 0
  margin: 0
  padding: 0
  border: 0

  legend
    margin-bottom: 8px
    color: #f3f1f5
    font-size: 12px
    font-weight: 750

.layout-options
  grid-template-columns: repeat(2, minmax(0, 1fr))

.layout-choice
  display: flex
  min-width: 0
  align-items: flex-start
  gap: 8px
  padding: 12px
  border: 1px solid #343539
  border-radius: 8px
  cursor: pointer

  &:has(input:checked)
    background: #202224
    border-color: #f2f1d0

  input
    width: 15px
    height: 15px
    margin: 2px 0 0
    accent-color: #f2f1d0

  span
    display: grid
    gap: 4px

  strong
    color: #f3f1f5
    font-size: 12px

  small
    color: #a8a4ad
    font-size: 10px
    font-weight: 450
    line-height: 1.4

.variable-help
  margin: -3px 0 1px
  color: #a8a4ad
  font-size: 10px
  line-height: 1.6

  code
    color: #f2f1d0
    font-size: 10px

.color-options
  grid-template-columns: repeat(3, minmax(0, 1fr))
  padding: 12px
  background: #202224
  border-radius: 8px

  label
    display: grid
    justify-items: start
    gap: 7px
    color: #a8a4ad
    font-size: 11px
    font-weight: 650

  input
    width: 45px
    height: 32px
    padding: 2px
    background: #171819
    border: 1px solid #343539
    border-radius: 6px
    cursor: pointer

.block-options
  grid-template-columns: repeat(3, minmax(0, 1fr))
  padding: 12px
  background: #202224
  border-radius: 8px

  legend
    margin-bottom: 1px

  label
    display: flex
    align-items: center
    gap: 6px
    color: #a8a4ad
    font-size: 10px
    line-height: 1.35

  input
    width: 15px
    height: 15px
    flex: 0 0 auto
    accent-color: #f2f1d0

.image-field
  display: grid
  gap: 6px

  > label
    color: #f3f1f5
    font-size: 12px
    font-weight: 700

  input[type="file"]
    color: #a8a4ad
    font-size: 11px

  small
    color: #a8a4ad
    font-size: 10px

.image-status
  display: flex
  flex-wrap: wrap
  align-items: center
  justify-content: space-between
  gap: 8px
  padding: 8px 10px
  color: #a8e0bf
  background: #1b2922
  border-radius: 7px
  font-size: 11px

.template-actions
  display: flex
  flex-wrap: wrap
  justify-content: flex-end
  gap: 8px

.publication-note
  padding: 10px 12px
  color: #a8a4ad
  background: #29281e
  border-radius: 7px
  font-size: 11px
  line-height: 1.5

.text-button
  padding: 4px 0
  color: #f2f1d0
  background: transparent
  border: 0
  cursor: pointer
  font: inherit
  font-size: 11px
  font-weight: 700
  text-decoration: underline
  text-underline-offset: 3px

.version-link
  justify-self: end

.preview-panel
  min-width: 0

.preview-heading
  align-items: flex-start

.preview-switch
  display: flex
  gap: 2px
  padding: 3px
  background: #202224
  border-radius: 8px

  button
    min-height: 44px
    padding: 0 9px
    color: #a8a4ad
    background: transparent
    border: 0
    border-radius: 6px
    cursor: pointer
    font: inherit
    font-size: 10px
    font-weight: 700

    &[aria-pressed="true"]
      color: #f2f1d0
      background: #171819
      box-shadow: 0 1px 4px rgba(48, 39, 31, .1)

.preview-example
  margin: 8px 0 16px
  color: #a8a4ad
  font-size: 10px

.preview-stage
  min-width: 0
  padding: 14px
  background: #202224
  border-radius: 9px
  transition: width .15s ease

  :deep(article)
    width: 100%
    margin: 0 auto

.preview-mobile
  width: min(100%, 420px)
  margin: 0 auto
  padding: 12px
  background: #f3f1f5
  border: 5px solid #f3f1f5
  border-radius: 24px

  :deep(article)
    min-height: 550px
    border-radius: 14px

.template-loading
  margin-top: 15px
  padding: 28px
  color: #a8a4ad
  text-align: center

.template-page-heading .button
  flex: 0 0 auto

@media (max-width: 980px)
  .template-workspace
    grid-template-columns: 1fr
  .invitation-issuer
    grid-template-columns: 1fr
  .invitation-totals
    grid-template-columns: repeat(2, minmax(0, 1fr))
  .invitation-record-heading
    align-items: flex-start
    flex-direction: column
  .invitation-meta
    grid-template-columns: 1fr

  .automation-fields
    grid-template-columns: repeat(2, minmax(0, 1fr))

@media (max-width: 620px)
  .automation-panel, .automation-history, .automation-suppression
    padding: 17px

  .automation-fields
    grid-template-columns: 1fr

  .automation-sample
    grid-template-columns: 1fr

  .automation-job-heading
    flex-direction: column

  .automation-job dl
    grid-template-columns: 1fr

  .published-event-actions
    display: grid
    grid-template-columns: 1fr

@media (max-width: 600px)
  .template-page-heading
    align-items: flex-start
    flex-direction: column

    h2
      font-size: 27px

  .template-editor, .preview-panel
    padding: 17px

  .template-editor-heading, .preview-heading
    align-items: flex-start
    flex-direction: column

  .layout-options, .block-options
    grid-template-columns: 1fr

  .template-actions
    justify-content: stretch

    .button
      flex: 1

  .preview-stage
    padding: 8px

  .preview-mobile
    padding: 8px
</style>
