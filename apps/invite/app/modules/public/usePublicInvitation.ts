import { eventTemplateValues, type TemplateInput, type TemplateVariable } from '@zingara/contracts'
import { eventDateLabel, eventDeadlineLabel } from '../../../../../packages/invitation-ui/date-labels'

export type ReplyStatus = 'pending' | 'accepted' | 'declined'
export type PublicInvitation = {
  guest: { name: string }
  event: { name: string, location: string, address: string, startsAt: string, timeZone: string }
  template: TemplateInput
  response: { status: ReplyStatus, companions: string[], version: number, respondedAt?: string }
  companionLimit: number
  companionNamesRequired: boolean
  rsvpDeadline: string
  expiresAt: string
}

type RsvpResult = {
  response: {
    status: ReplyStatus
    companions: string[]
    version: number
    respondedAt: string
    peopleCount: number
  }
}

type State<T> = { value: T }

function statusCode(error: unknown) {
  if (!error || typeof error !== 'object') return 0
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
  if ('status' in error && typeof error.status === 'number') return error.status
  return 0
}

export function usePublicInvitation(token: State<string>) {
  const invitation = ref<PublicInvitation | null>(null)
  const csrf = ref('')
  const loading = ref(true)
  const saving = ref(false)
  const unavailable = ref(false)
  const loadError = ref('')
  const formError = ref('')
  const notice = ref('')
  const answer = ref<'accepted' | 'declined' | ''>('')
  const companions = ref<string[]>([])
  const now = ref(Date.now())
  const resultHeading = ref<HTMLElement | null>(null)
  let clock: ReturnType<typeof setInterval> | undefined

  async function loadInvitation() {
    loading.value = true
    unavailable.value = false
    loadError.value = ''
    formError.value = ''
    try {
      const result = await $fetch.raw<{ invitation: PublicInvitation }>(
        `/api/public/invitations/${encodeURIComponent(token.value)}`,
        { cache: 'no-store' },
      )
      if (!result._data?.invitation) throw new Error('Convite sem dados')
      invitation.value = result._data.invitation
      csrf.value = result.headers.get('x-rsvp-csrf') || ''
      answer.value = invitation.value.response.status === 'pending' ? '' : invitation.value.response.status
      companions.value = [...invitation.value.response.companions]
      now.value = Date.now()
    } catch (error) {
      invitation.value = null
      if (statusCode(error) === 404) unavailable.value = true
      else loadError.value = 'Não foi possível carregar o convite. Tente novamente.'
    } finally {
      loading.value = false
    }
  }

  const deadlinePassed = computed(() => invitation.value ? now.value >= Date.parse(invitation.value.rsvpDeadline) : false)
  const canReply = computed(() => Boolean(invitation.value && !deadlinePassed.value && !saving.value))
  const imageUrl = computed(() => {
    const id = invitation.value?.template.imageAssetId
    return id && /^[a-f0-9]{32}$/.test(id) ? `/media/${id}` : undefined
  })
  const dateLabel = computed(() => {
    if (!invitation.value) return ''
    const event = invitation.value.event
    try {
      return eventDateLabel(event.startsAt, event.timeZone)
    } catch {
      return 'Confira a data com a organização'
    }
  })
  const deadlineLabel = computed(() => {
    if (!invitation.value) return ''
    try {
      return eventDeadlineLabel(invitation.value.rsvpDeadline, invitation.value.event.timeZone)
    } catch {
      return 'data informada pela organização'
    }
  })
  const values = computed<Partial<Record<TemplateVariable, string | number>>>(() => {
    if (!invitation.value) return {}
    const event = invitation.value.event
    return {
      ...eventTemplateValues({ ...event, rsvpDeadline: invitation.value.rsvpDeadline }),
      'convidado.nome': invitation.value.guest.name,
      'convite.link': import.meta.client ? window.location.href : '',
      'convite.limite_acompanhantes': invitation.value.companionLimit,
    }
  })
  const responseLabel = computed(() => invitation.value?.response.status === 'accepted' ? 'Presença confirmada'
    : invitation.value?.response.status === 'declined' ? 'Presença recusada' : 'Aguardando resposta')
  const peopleCount = computed(() => invitation.value?.response.status === 'accepted'
    ? 1 + invitation.value.response.companions.length : 0)

  function addCompanion() {
    if (!invitation.value || companions.value.length >= invitation.value.companionLimit) return
    companions.value.push('')
  }

  async function saveResponse() {
    if (!invitation.value || !answer.value || !canReply.value) return
    formError.value = ''
    notice.value = ''
    if (answer.value === 'accepted' && invitation.value.companionNamesRequired &&
      companions.value.some(name => !name.trim())) {
      formError.value = 'Preencha o nome de cada acompanhante.'
      return
    }
    saving.value = true
    try {
      const result = await $fetch<RsvpResult>(`/api/public/invitations/${encodeURIComponent(token.value)}/rsvp`, {
        method: 'PUT',
        headers: { 'x-rsvp-csrf': csrf.value },
        body: {
          status: answer.value,
          companions: answer.value === 'accepted' ? companions.value.map(name => name.trim()) : [],
          expectedVersion: invitation.value.response.version,
        },
      })
      invitation.value.response = result.response
      companions.value = [...result.response.companions]
      now.value = Date.now()
      notice.value = answer.value === 'accepted'
        ? `Presença confirmada para ${result.response.peopleCount} ${result.response.peopleCount === 1 ? 'pessoa' : 'pessoas'}.`
        : 'Resposta registrada. Você não comparecerá.'
      await nextTick()
      resultHeading.value?.focus()
    } catch (error) {
      const status = statusCode(error)
      formError.value = status === 409 ? 'Outra resposta foi registrada. Recarregue o convite antes de tentar novamente.'
        : status === 403 ? 'O prazo de resposta terminou ou a verificação expirou. Recarregue o convite.'
          : status === 404 ? 'Este link não está mais disponível.'
            : status === 429 ? 'Muitas tentativas. Aguarde um pouco e tente novamente.'
              : 'Não foi possível salvar a resposta. Tente novamente.'
      if (status === 404) unavailable.value = true
    } finally {
      saving.value = false
    }
  }

  onMounted(() => {
    void loadInvitation()
    clock = setInterval(() => { now.value = Date.now() }, 30_000)
  })
  onUnmounted(() => { if (clock) clearInterval(clock) })
  watch(token, () => { if (import.meta.client) void loadInvitation() })

  return {
    invitation,
    loading,
    saving,
    unavailable,
    loadError,
    formError,
    notice,
    answer,
    companions,
    resultHeading,
    deadlinePassed,
    canReply,
    imageUrl,
    dateLabel,
    deadlineLabel,
    values,
    responseLabel,
    peopleCount,
    loadInvitation,
    addCompanion,
    saveResponse,
  }
}
