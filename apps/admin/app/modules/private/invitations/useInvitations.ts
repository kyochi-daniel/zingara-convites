import type { Guest } from '~/modules/private/guests/useGuests'

type RefLike<T> = { value: T }
type EventLike = {
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

export type Invitation = {
  id: string
  guestId: string
  guestName: string
  templateVersion: number
  expiresAt: string
  revokedAt?: string
  responseStatus: 'pending' | 'accepted' | 'declined'
  companions: Array<{ name?: string } | string>
  respondedAt?: string
  responseVersion: number
  createdAt: string
}

export type InvitationTotals = { pending: number; accepted: number; declined: number; revoked: number; peopleConfirmed: number }

const emptyTotals = (): InvitationTotals => ({ pending: 0, accepted: 0, declined: 0, revoked: 0, peopleConfirmed: 0 })

export function useInvitations(dependencies: {
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
  events: RefLike<EventLike[]>
  activeArea: RefLike<string>
}) {
  const invitationEvent = ref<EventLike | null>(null)
  const invitationGuests = ref<Guest[]>([])
  const invitationGuestId = ref('')
  const invitationGuestQuery = ref('')
  const invitationGuestSearch = ref('')
  const invitationGuestPage = ref(1)
  const invitationGuestTotal = ref(0)
  const invitationItems = ref<Invitation[]>([])
  const invitationTotals = ref<InvitationTotals>(emptyTotals())
  const dashboardTotals = ref<InvitationTotals>(emptyTotals())
  const dashboardEventId = ref('')
  const guestStatusById = ref<Record<string, 'accepted' | 'pending' | 'declined' | 'revoked'>>({})
  const invitationLoading = ref(false)
  const invitationSaving = ref(false)
  const invitationError = ref('')
  const invitationNotice = ref('')
  const invitationAvailableLinks = ref<Record<string, string>>({})
  const revealedInvitation = ref<{ id: string; link: string } | null>(null)
  const invitationConfirmation = ref<{ id: string; action: 'rotate' | 'revoke' } | null>(null)

  const invitationGuestPages = computed(() => Math.max(1, Math.ceil(invitationGuestTotal.value / 100)))
  const selectedInvitationGuest = computed(() => invitationGuests.value.find(guest => guest.id === invitationGuestId.value))
  const organizationPath = (resource: string) => `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/${resource}`
  const invitationCollectionPath = (eventId = invitationEvent.value?.id ?? '') => organizationPath(`events/${encodeURIComponent(eventId)}/invitations`)

  function resetInvitations() {
    invitationEvent.value = null
    invitationGuests.value = []
    invitationGuestId.value = ''
    invitationGuestQuery.value = ''
    invitationGuestSearch.value = ''
    invitationGuestPage.value = 1
    invitationGuestTotal.value = 0
    invitationItems.value = []
    invitationTotals.value = emptyTotals()
    invitationAvailableLinks.value = {}
    revealedInvitation.value = null
    invitationConfirmation.value = null
  }

  async function loadDashboardTotals() {
    dashboardTotals.value = emptyTotals()
    dashboardEventId.value = ''
    guestStatusById.value = {}
    const event = dependencies.events.value.find(item => item.publishedTemplateVersion && item.status !== 'cancelled')
    if (!event) return
    const organizationId = dependencies.selectedOrganizationId.value
    try {
      const result = await $fetch<{ totals: InvitationTotals; items: Invitation[] }>(`/api/admin/organizations/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(event.id)}/invitations`)
      if (dependencies.selectedOrganizationId.value === organizationId) {
        dashboardTotals.value = result.totals
        dashboardEventId.value = event.id
        guestStatusById.value = Object.fromEntries(result.items.map(item => [item.guestId, item.revokedAt ? 'revoked' : item.responseStatus]))
      }
    } catch { /* Resumo indisponível; demais dados continuam visíveis. */ }
  }

  async function loadInvitations() {
    if (!invitationEvent.value) return
    invitationLoading.value = true
    invitationError.value = ''
    try {
      const result = await $fetch<{ items: Invitation[]; totals: InvitationTotals }>(invitationCollectionPath())
      invitationItems.value = result.items
      invitationTotals.value = result.totals
    } catch {
      invitationError.value = 'Não foi possível carregar os convites deste evento.'
    } finally { invitationLoading.value = false }
  }

  async function loadInvitationGuests() {
    if (!dependencies.selectedOrganizationId.value) return
    const result = await $fetch<{ items: Guest[]; total: number }>(organizationPath('guests'), {
      query: { page: invitationGuestPage.value, limit: 100, ...(invitationGuestSearch.value ? { q: invitationGuestSearch.value } : {}) },
    })
    invitationGuests.value = result.items
    invitationGuestTotal.value = result.total
    invitationGuestId.value = result.items[0]?.id ?? ''
  }

  async function openInvitations(event: EventLike) {
    resetInvitations()
    invitationEvent.value = event
    dependencies.activeArea.value = 'invitations'
    if (event.status !== 'published' && !event.publishedTemplateVersion) {
      invitationError.value = 'Publique o convite do evento antes de emitir convites.'
      return
    }
    invitationLoading.value = true
    try {
      const [guestResult, invitationResult] = await Promise.all([
        $fetch<{ items: Guest[]; total: number }>(organizationPath('guests'), { query: { page: 1, limit: 100 } }),
        $fetch<{ items: Invitation[]; totals: InvitationTotals }>(invitationCollectionPath()),
      ])
      invitationGuests.value = guestResult.items
      invitationGuestTotal.value = guestResult.total
      invitationItems.value = invitationResult.items
      invitationTotals.value = invitationResult.totals
      invitationGuestId.value = guestResult.items[0]?.id ?? ''
    } catch {
      invitationError.value = 'Não foi possível carregar os convidados e convites do evento.'
    } finally { invitationLoading.value = false }
  }

  async function searchInvitationGuests() {
    invitationGuestPage.value = 1
    invitationGuestSearch.value = invitationGuestQuery.value.trim()
    invitationError.value = ''
    try { await loadInvitationGuests() }
    catch { invitationError.value = 'Não foi possível buscar contatos para emissão.' }
  }

  async function changeInvitationGuestPage(page: number) {
    invitationGuestPage.value = page
    invitationError.value = ''
    try { await loadInvitationGuests() }
    catch { invitationError.value = 'Não foi possível carregar os contatos desta página.' }
  }

  async function issueInvitation() {
    if (!invitationEvent.value || !invitationGuestId.value || invitationSaving.value) return
    invitationSaving.value = true
    invitationError.value = ''
    invitationNotice.value = ''
    revealedInvitation.value = null
    try {
      const result = await $fetch<{ invitation: Invitation; link: string }>(invitationCollectionPath(), {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: { guestId: invitationGuestId.value },
      })
      invitationAvailableLinks.value = { ...invitationAvailableLinks.value, [result.invitation.id]: result.link }
      invitationNotice.value = `Convite pronto para ${result.invitation.guestName}. O link só aparece quando você solicitar.`
      await loadInvitations()
    } catch {
      invitationError.value = 'Não foi possível emitir o convite. Confira se o evento está publicado e se o contato pertence à organização.'
    } finally { invitationSaving.value = false }
  }

  async function revealInvitationLink(item: Invitation) {
    invitationError.value = ''
    try {
      const link = invitationAvailableLinks.value[item.id]
        ?? (await $fetch<{ link: string }>(`${invitationCollectionPath()}/${encodeURIComponent(item.id)}/link`)).link
      invitationAvailableLinks.value = { ...invitationAvailableLinks.value, [item.id]: link }
      revealedInvitation.value = { id: item.id, link }
    } catch { invitationError.value = 'Não foi possível obter o link ativo deste convite.' }
  }

  async function copyInvitationLink() {
    if (!revealedInvitation.value) return
    try {
      await navigator.clipboard.writeText(revealedInvitation.value.link)
      invitationNotice.value = 'Link copiado.'
    } catch { invitationError.value = 'O navegador não permitiu copiar. Selecione o link exibido e copie manualmente.' }
  }

  async function confirmInvitationAction() {
    const pending = invitationConfirmation.value
    if (!pending || !invitationEvent.value) return
    invitationSaving.value = true
    invitationError.value = ''
    invitationNotice.value = ''
    try {
      const result = await $fetch<{ link?: string }>(`${invitationCollectionPath()}/${encodeURIComponent(pending.id)}/${pending.action}`, {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: {},
      })
      if (pending.action === 'rotate' && result.link) {
        invitationAvailableLinks.value = { ...invitationAvailableLinks.value, [pending.id]: result.link }
        invitationNotice.value = 'Link renovado. O anterior deixou de funcionar; revele o novo link quando precisar.'
      } else {
        const { [pending.id]: _removed, ...remaining } = invitationAvailableLinks.value
        invitationAvailableLinks.value = remaining
        invitationNotice.value = 'Convite revogado.'
      }
      revealedInvitation.value = null
      invitationConfirmation.value = null
      await loadInvitations()
    } catch {
      invitationError.value = pending.action === 'rotate' ? 'Não foi possível renovar o link.' : 'Não foi possível revogar o convite.'
    } finally { invitationSaving.value = false }
  }

  function invitationStatus(item: Invitation) {
    return item.revokedAt ? 'Revogado' : item.responseStatus === 'accepted' ? 'Confirmado' : item.responseStatus === 'declined' ? 'Recusado' : 'Pendente'
  }

  function companionSummary(item: Invitation) {
    return item.companions.map(companion => typeof companion === 'string' ? companion : companion.name).filter(Boolean).join(', ') || 'Nenhum'
  }

  return {
    invitationEvent, invitationGuests, invitationGuestId, invitationGuestQuery, invitationGuestSearch,
    invitationGuestPage, invitationGuestTotal, invitationItems, invitationTotals, dashboardTotals,
    dashboardEventId, guestStatusById, invitationLoading, invitationSaving, invitationError,
    invitationNotice, invitationAvailableLinks, revealedInvitation, invitationConfirmation,
    invitationGuestPages, selectedInvitationGuest, invitationCollectionPath, resetInvitations, loadDashboardTotals, loadInvitations,
    openInvitations, searchInvitationGuests, changeInvitationGuestPage, issueInvitation,
    revealInvitationLink, copyInvitationLink, confirmInvitationAction, invitationStatus, companionSummary,
  }
}
