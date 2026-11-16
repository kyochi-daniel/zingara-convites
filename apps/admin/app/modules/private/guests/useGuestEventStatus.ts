type RefLike<T> = { value: T }

type GuestEvent = {
  id: string
  name: string
  status: string
  publishedTemplateVersion?: number
}

type GuestRsvpStatus = 'accepted' | 'pending' | 'declined' | 'revoked'

type GuestInvitation = {
  guestId: string
  responseStatus: Exclude<GuestRsvpStatus, 'revoked'>
  revokedAt?: string
}

type GuestEventStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type Dependencies = {
  selectedOrganizationId: RefLike<string>
  events: RefLike<GuestEvent[]>
  storage?: GuestEventStorage
}

export function useGuestEventStatus(dependencies: Dependencies) {
  const guestRsvpEventId = ref('')
  const guestRsvpStatusById = ref<Record<string, GuestRsvpStatus>>({})
  const guestRsvpLoading = ref(false)
  const guestRsvpError = ref('')
  let loadVersion = 0

  const guestRsvpEvents = computed(() => dependencies.events.value.filter(event =>
    event.status !== 'cancelled' && !!event.publishedTemplateVersion))
  const guestRsvpEvent = computed(() => guestRsvpEvents.value.find(event => event.id === guestRsvpEventId.value) ?? null)

  function storageKey(organizationId = dependencies.selectedOrganizationId.value) {
    return `zingara:guest-rsvp-event:${organizationId}`
  }

  function availableStorage(): GuestEventStorage | undefined {
    if (dependencies.storage) return dependencies.storage
    if (process.client) return localStorage
  }

  function readSavedEvent(organizationId: string) {
    try { return availableStorage()?.getItem(storageKey(organizationId)) ?? '' }
    catch { return '' }
  }

  function saveEvent(organizationId: string, eventId: string) {
    try {
      if (eventId) availableStorage()?.setItem(storageKey(organizationId), eventId)
      else availableStorage()?.removeItem(storageKey(organizationId))
    }
    catch { /* O seletor continua funcional sem persistência do navegador. */ }
  }

  function resetGuestRsvpSelection() {
    loadVersion++
    guestRsvpEventId.value = ''
    guestRsvpStatusById.value = {}
    guestRsvpLoading.value = false
    guestRsvpError.value = ''
  }

  async function loadGuestRsvpStatuses() {
    const organizationId = dependencies.selectedOrganizationId.value
    const eventId = guestRsvpEventId.value
    const version = ++loadVersion
    guestRsvpStatusById.value = {}
    guestRsvpError.value = ''
    if (!organizationId || !eventId) return
    guestRsvpLoading.value = true
    try {
      const result = await $fetch<{ items: GuestInvitation[] }>(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/invitations`,
      )
      if (version !== loadVersion || organizationId !== dependencies.selectedOrganizationId.value || eventId !== guestRsvpEventId.value) return
      guestRsvpStatusById.value = Object.fromEntries(result.items.map(item => [
        item.guestId,
        item.revokedAt ? 'revoked' : item.responseStatus,
      ]))
    } catch {
      if (version !== loadVersion || organizationId !== dependencies.selectedOrganizationId.value || eventId !== guestRsvpEventId.value) return
      guestRsvpError.value = 'Não foi possível carregar o RSVP deste evento.'
    } finally {
      if (version === loadVersion) guestRsvpLoading.value = false
    }
  }

  async function selectGuestRsvpEvent(eventId: string) {
    const organizationId = dependencies.selectedOrganizationId.value
    const validEventId = guestRsvpEvents.value.some(event => event.id === eventId) ? eventId : ''
    guestRsvpEventId.value = validEventId
    guestRsvpStatusById.value = {}
    guestRsvpError.value = ''
    if (!validEventId) {
      saveEvent(organizationId, '')
      return
    }
    saveEvent(organizationId, validEventId)
    await loadGuestRsvpStatuses()
  }

  async function syncGuestRsvpSelection() {
    const organizationId = dependencies.selectedOrganizationId.value
    resetGuestRsvpSelection()
    if (!organizationId) return
    const savedEventId = readSavedEvent(organizationId)
    const savedEvent = guestRsvpEvents.value.find(event => event.id === savedEventId)
    if (savedEventId && !savedEvent) saveEvent(organizationId, '')
    const eventId = savedEvent?.id ?? (guestRsvpEvents.value.length === 1 ? guestRsvpEvents.value[0]!.id : '')
    if (eventId) await selectGuestRsvpEvent(eventId)
  }

  return {
    guestRsvpEventId,
    guestRsvpStatusById,
    guestRsvpLoading,
    guestRsvpError,
    guestRsvpEvents,
    guestRsvpEvent,
    resetGuestRsvpSelection,
    loadGuestRsvpStatuses,
    selectGuestRsvpEvent,
    syncGuestRsvpSelection,
  }
}
