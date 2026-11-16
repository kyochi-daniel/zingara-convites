type RefLike<T> = { value: T }

export type AssistantMessage = {
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type AssistantNavigation =
  | { type: 'area'; area: 'home' | 'events' | 'guests' | 'settings' | 'organizations' | 'connection' }
  | { type: 'event'; area: 'events' | 'template' | 'invitations' | 'deliveries' | 'automations'; eventId: string }
  | { type: 'event'; area: 'campaigns'; eventId: string; step?: CampaignStep }

export const campaignSteps = [
  { id: 'import', label: 'Importar e revisar' },
  { id: 'verify', label: 'Verificar contatos' },
  { id: 'message', label: 'Preparar mensagem' },
  { id: 'review', label: 'Revisar campanha' },
  { id: 'monitor', label: 'Acompanhar campanha' },
] as const
export type CampaignStep = typeof campaignSteps[number]['id']

type AssistantResponse = {
  messages: AssistantMessage[]
  reply?: string
  navigation?: unknown
}

const areas = ['home', 'events', 'guests', 'settings', 'organizations', 'connection'] as const
const eventAreas = ['events', 'template', 'invitations', 'deliveries', 'automations'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assistantMessages(value: unknown): AssistantMessage[] | null {
  if (!Array.isArray(value)) return null
  const messages = value.filter((message): message is AssistantMessage => isRecord(message)
    && (message.role === 'user' || message.role === 'assistant')
    && typeof message.content === 'string'
    && typeof message.createdAt === 'string')
  return messages.length === value.length ? messages : null
}

export function resolveAssistantNavigation(value: unknown, eventIds: readonly string[]): AssistantNavigation | null {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  if (value.type === 'area' && typeof value.area === 'string' && areas.includes(value.area as typeof areas[number])) {
    if (keys.some(key => !['type', 'area'].includes(key))) return null
    return { type: 'area', area: value.area as typeof areas[number] }
  }
  if (value.type === 'event' && value.area === 'campaigns' && typeof value.eventId === 'string' && eventIds.includes(value.eventId)) {
    if (keys.some(key => !['type', 'area', 'eventId', 'step'].includes(key))) return null
    if (value.step !== undefined && !campaignSteps.some(step => step.id === value.step)) return null
    return { type: 'event', area: 'campaigns', eventId: value.eventId,
      ...(value.step ? { step: value.step as CampaignStep } : {}) }
  }
  if (value.type === 'event' && typeof value.area === 'string' && typeof value.eventId === 'string'
    && eventAreas.includes(value.area as typeof eventAreas[number]) && eventIds.includes(value.eventId)) {
    if (keys.some(key => !['type', 'area', 'eventId'].includes(key))) return null
    return { type: 'event', area: value.area as typeof eventAreas[number], eventId: value.eventId }
  }
  return null
}

export function useAssistant(dependencies: {
  organizationId: RefLike<string>
  csrfToken: RefLike<string>
}) {
  const messages = ref<AssistantMessage[]>([])
  const loading = ref(false)
  const sending = ref(false)
  const error = ref('')
  let requestSerial = 0

  function path(organizationId: string) {
    return `/api/admin/organizations/${encodeURIComponent(organizationId)}/assistant`
  }

  function resetAssistant() {
    requestSerial += 1
    messages.value = []
    loading.value = false
    sending.value = false
    error.value = ''
  }

  async function loadAssistant() {
    const organizationId = dependencies.organizationId.value
    if (!organizationId) return
    const requestId = ++requestSerial
    loading.value = true
    error.value = ''
    try {
      const result = await $fetch<AssistantResponse>(path(organizationId))
      const received = assistantMessages(result.messages)
      if (!received) throw new Error('invalid response')
      if (requestId === requestSerial && organizationId === dependencies.organizationId.value) messages.value = received
    } catch {
      if (requestId === requestSerial && organizationId === dependencies.organizationId.value) {
        error.value = 'Não foi possível carregar a conversa. Tente novamente.'
      }
    } finally {
      if (requestId === requestSerial) loading.value = false
    }
  }

  async function sendMessage(message: string): Promise<unknown | null> {
    const content = message.trim()
    const organizationId = dependencies.organizationId.value
    if (!content || !organizationId || sending.value) return null
    const requestId = ++requestSerial
    sending.value = true
    error.value = ''
    try {
      const result = await $fetch<AssistantResponse>(path(organizationId), {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: { message: content },
      })
      const received = assistantMessages(result.messages)
      if (!received) throw new Error('invalid response')
      if (requestId !== requestSerial || organizationId !== dependencies.organizationId.value) return null
      messages.value = received
      return result.navigation ?? null
    } catch {
      if (requestId === requestSerial && organizationId === dependencies.organizationId.value) {
        error.value = 'Não foi possível falar com o assistente. Tente novamente.'
      }
      return null
    } finally {
      if (requestId === requestSerial) sending.value = false
    }
  }

  return { messages, loading, sending, error, resetAssistant, loadAssistant, sendMessage }
}
