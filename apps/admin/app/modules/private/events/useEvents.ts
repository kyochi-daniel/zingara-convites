import { DEFAULT_EVENT_TIME_ZONE, eventDateOffset, localDateTime } from './date-time'

type RefLike<T> = { value: T }

export type EventItem = {
  id: string
  name: string
  description?: string
  location: string
  address: string
  startsAt: string
  endsAt: string
  rsvpDeadline: string
  timeZone: string
  companionLimit: number
  companionNamesRequired: boolean
  status: string
  revision?: number
  changeVersion?: number
  cancelledAt?: string
  publishedTemplateVersion?: number
}

export function useEvents(dependencies: {
  events: RefLike<EventItem[]>
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
  error: RefLike<string>
  notice: RefLike<string>
  saving: RefLike<boolean>
  loadDashboardTotals: () => Promise<void>
}) {
  const events = dependencies.events
  const editingEventId = ref<string | null>(null)
  const eventForm = reactive({
    name: '', description: '', location: '', address: '', startsAt: '', endsAt: '', rsvpDeadline: '',
    timeZone: DEFAULT_EVENT_TIME_ZONE, companionLimit: 0, companionNamesRequired: false,
  })
  const publishedEventEditId = ref('')
  const publishedEventRevision = ref(0)
  const publishedEventEditSaving = ref(false)
  const publishedEventCancelId = ref('')
  const publishedEventCancelConfirmed = ref(false)
  const publishedEventCancelSaving = ref(false)
  const publishedEventNotice = ref('')
  const publishedEventError = ref('')
  const publishedEventFeedbackId = ref('')
  const publishedEventForm = reactive({ name: '', description: '', location: '', address: '', startsAt: '', endsAt: '', rsvpDeadline: '', timeZone: '' })

  const eventTitle = computed(() => editingEventId.value ? 'Editar evento' : 'Novo evento')
  const csrfHeaders = computed(() => ({ 'x-csrf-token': dependencies.csrfToken.value }))
  const organizationPath = (resource: string) => `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/${resource}`

  function statusCodeOf(value: unknown) {
    return typeof value === 'object' && value && 'statusCode' in value ? Number(value.statusCode) : undefined
  }

  function resetEventForm() {
    editingEventId.value = null
    Object.assign(eventForm, {
      name: '', description: '', location: '', address: '', startsAt: '', endsAt: '', rsvpDeadline: '',
      timeZone: DEFAULT_EVENT_TIME_ZONE, companionLimit: 0, companionNamesRequired: false,
    })
  }

  function resetEvents() {
    events.value = []
    resetEventForm()
    publishedEventEditId.value = ''
    publishedEventCancelId.value = ''
    publishedEventCancelConfirmed.value = false
    publishedEventNotice.value = ''
    publishedEventError.value = ''
    publishedEventFeedbackId.value = ''
  }

  async function loadEvents() {
    if (!dependencies.selectedOrganizationId.value) return
    try {
      events.value = (await $fetch<{ items: EventItem[] }>(organizationPath('events'))).items
      await dependencies.loadDashboardTotals()
    } catch { dependencies.error.value = 'Não foi possível carregar os eventos.' }
  }

  function editEvent(event: EventItem) {
    editingEventId.value = event.id
    Object.assign(eventForm, {
      name: event.name, description: event.description ?? '', location: event.location, address: event.address,
      startsAt: localDateTime(event.startsAt, event.timeZone), endsAt: localDateTime(event.endsAt, event.timeZone),
      rsvpDeadline: localDateTime(event.rsvpDeadline, event.timeZone), timeZone: event.timeZone,
      companionLimit: event.companionLimit, companionNamesRequired: event.companionNamesRequired,
    })
    dependencies.error.value = ''
  }

  async function saveEvent() {
    dependencies.saving.value = true
    dependencies.error.value = ''
    dependencies.notice.value = ''
    try {
      const payload = {
        name: eventForm.name, description: eventForm.description, location: eventForm.location, address: eventForm.address,
        startsAt: eventDateOffset(eventForm.startsAt, eventForm.timeZone),
        endsAt: eventDateOffset(eventForm.endsAt, eventForm.timeZone),
        rsvpDeadline: eventDateOffset(eventForm.rsvpDeadline, eventForm.timeZone), timeZone: eventForm.timeZone,
        companionLimit: Number(eventForm.companionLimit), companionNamesRequired: eventForm.companionNamesRequired,
      }
      await $fetch(editingEventId.value ? `${organizationPath('events')}/${encodeURIComponent(editingEventId.value)}` : organizationPath('events'), {
        method: editingEventId.value ? 'PATCH' : 'POST', headers: csrfHeaders.value, body: payload,
      })
      dependencies.notice.value = editingEventId.value ? 'Evento atualizado.' : 'Evento criado como rascunho.'
      resetEventForm()
      await loadEvents()
    } catch (problem: unknown) {
      dependencies.error.value = problem instanceof Error ? problem.message : 'Não foi possível salvar. Confira os horários, o fuso e os campos obrigatórios.'
    } finally { dependencies.saving.value = false }
  }

  function openPublishedEventRevision(event: EventItem) {
    publishedEventEditId.value = event.id
    publishedEventFeedbackId.value = event.id
    publishedEventRevision.value = event.revision ?? 0
    publishedEventError.value = ''
    publishedEventNotice.value = ''
    Object.assign(publishedEventForm, {
      name: event.name, description: event.description ?? '', location: event.location, address: event.address,
      startsAt: localDateTime(event.startsAt, event.timeZone), endsAt: localDateTime(event.endsAt, event.timeZone),
      rsvpDeadline: localDateTime(event.rsvpDeadline, event.timeZone), timeZone: event.timeZone,
    })
  }

  function closePublishedEventRevision() {
    publishedEventEditId.value = ''
    publishedEventError.value = ''
  }

  async function revisePublishedEvent(event: EventItem) {
    if (publishedEventEditId.value !== event.id || publishedEventEditSaving.value) return
    publishedEventEditSaving.value = true
    publishedEventError.value = ''
    publishedEventNotice.value = ''
    try {
      const result = await $fetch<{ event: EventItem }>(`${organizationPath(`events/${encodeURIComponent(event.id)}`)}/revise`, {
        method: 'PUT', headers: csrfHeaders.value,
        body: {
          expectedRevision: publishedEventRevision.value,
          changes: {
            name: publishedEventForm.name.trim(), description: publishedEventForm.description.trim(),
            location: publishedEventForm.location.trim(), address: publishedEventForm.address.trim(),
            startsAt: eventDateOffset(publishedEventForm.startsAt, publishedEventForm.timeZone),
            endsAt: eventDateOffset(publishedEventForm.endsAt, publishedEventForm.timeZone),
            rsvpDeadline: eventDateOffset(publishedEventForm.rsvpDeadline, publishedEventForm.timeZone),
            timeZone: publishedEventForm.timeZone.trim(),
          },
        },
      })
      events.value = events.value.map(item => item.id === event.id ? result.event : item)
      publishedEventRevision.value = result.event.revision ?? publishedEventRevision.value + 1
      publishedEventNotice.value = 'Evento revisado. A nova versão pode planejar avisos conforme as regras ativas.'
      publishedEventEditId.value = ''
    } catch (problem: unknown) {
      publishedEventError.value = statusCodeOf(problem) === 409
        ? 'O evento mudou em outra sessão. Atualize a agenda antes de revisar.'
        : problem instanceof Error ? problem.message : 'Não foi possível revisar o evento. Confira os horários e o fuso.'
    } finally { publishedEventEditSaving.value = false }
  }

  function startPublishedEventCancellation(event: EventItem) {
    publishedEventCancelId.value = event.id
    publishedEventFeedbackId.value = event.id
    publishedEventCancelConfirmed.value = false
    publishedEventError.value = ''
    publishedEventNotice.value = ''
  }

  function closePublishedEventCancellation() {
    publishedEventCancelId.value = ''
    publishedEventCancelConfirmed.value = false
  }

  async function cancelPublishedEvent(event: EventItem) {
    if (publishedEventCancelId.value !== event.id || !publishedEventCancelConfirmed.value || publishedEventCancelSaving.value) return
    publishedEventCancelSaving.value = true
    publishedEventError.value = ''
    publishedEventNotice.value = ''
    try {
      const result = await $fetch<{ event: EventItem }>(`${organizationPath(`events/${encodeURIComponent(event.id)}`)}/cancel`, {
        method: 'POST', headers: csrfHeaders.value, body: { expectedRevision: event.revision ?? 0 },
      })
      events.value = events.value.map(item => item.id === event.id ? result.event : item)
      closePublishedEventCancellation()
      publishedEventNotice.value = 'Evento cancelado. As regras e tarefas dependentes serão reavaliadas; a interface não afirma entrega de avisos.'
    } catch (problem: unknown) {
      publishedEventError.value = statusCodeOf(problem) === 409
        ? 'O evento mudou ou já foi cancelado. Atualize a agenda antes de tentar novamente.'
        : 'Não foi possível cancelar o evento.'
    } finally { publishedEventCancelSaving.value = false }
  }

  return {
    events, editingEventId, eventForm, eventTitle, publishedEventEditId, publishedEventRevision,
    publishedEventEditSaving, publishedEventCancelId, publishedEventCancelConfirmed, publishedEventCancelSaving,
    publishedEventNotice, publishedEventError, publishedEventFeedbackId, publishedEventForm,
    resetEventForm, resetEvents, loadEvents, editEvent, saveEvent, openPublishedEventRevision,
    closePublishedEventRevision, revisePublishedEvent, startPublishedEventCancellation,
    closePublishedEventCancellation, cancelPublishedEvent,
  }
}
