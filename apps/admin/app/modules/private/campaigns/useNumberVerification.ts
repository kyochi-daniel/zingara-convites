import type { CampaignConnection } from './useCampaigns'

type RefLike<T> = { value: T }
export type NumberResult = { phone: string; state: 'invalid_format' | 'not_checked' | 'unsupported' | 'registered' | 'not_registered' | 'unavailable' | 'rate_limited'
  checkedAt?: string; connection?: { id: string; instanceName: string; revision: number | null }; cached?: boolean }
type NumberPreview = { channel: 'baileys' | 'cloud'; lookupSupported: boolean; mode: 'fake' | 'real'
  connection: { id: string; instanceName: string; revision: number | null }
  limits: { batch: number; perMinute: number; perDay: number }; results: NumberResult[] }

export function numberStateLabel(state?: NumberResult['state']) {
  return state ? ({ invalid_format: 'Formato inválido', not_checked: 'Não consultado', unsupported: 'Consulta indisponível neste canal',
    registered: 'Registrado no WhatsApp', not_registered: 'Não registrado no WhatsApp', unavailable: 'Consulta indisponível', rate_limited: 'Limite de consultas atingido' })[state] : 'Não consultado'
}

export function useNumberVerification(dependencies: {
  organizationId: RefLike<string>; csrfToken: RefLike<string>; connection: RefLike<CampaignConnection | null>
}) {
  const capability = ref<NumberPreview | null>(null)
  const results = ref<Record<string, NumberResult>>({})
  const confirmed = ref(false)
  const busy = ref(false)
  const error = ref('')
  let serial = 0
  let previewPhones = ''
  function resetVerification() {
    serial++
    capability.value = null
    results.value = {}
    confirmed.value = false
    busy.value = false
    error.value = ''
    previewPhones = ''
  }
  async function request(action: 'numbers-preview' | 'numbers-verify', phones: string[]) {
    const connection = dependencies.connection.value
    const organizationId = dependencies.organizationId.value
    if (!connection || !organizationId || busy.value || !phones.length) return
    const requestId = ++serial
    const current = () => requestId === serial && organizationId === dependencies.organizationId.value
      && connection.connectionId === dependencies.connection.value?.connectionId && connection.revision === dependencies.connection.value?.revision
    busy.value = true
    error.value = ''
    try {
      const result = await $fetch<NumberPreview>(`/api/admin/organizations/${encodeURIComponent(organizationId)}/connections/evolution/${encodeURIComponent(connection.connectionId)}/${action}`, {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value },
        body: { phones, ...(action === 'numbers-verify' ? { confirm: true } : {}) },
      })
      if (!current()) return
      capability.value = result
      results.value = { ...results.value, ...Object.fromEntries(result.results.map(item => [item.phone, item])) }
    } catch {
      if (current()) error.value = 'Não foi possível consultar estes números. Atualize a conexão e tente novamente; falha não significa número inexistente.'
    } finally { if (requestId === serial) busy.value = false }
  }
  async function previewNumbers(phones: string[]) {
    resetVerification()
    previewPhones = [...new Set(phones)].join(',')
    await request('numbers-preview', [...new Set(phones)].slice(0, 200))
  }
  async function verifyNumbers(phones: string[]) {
    if (!confirmed.value || !capability.value?.lookupSupported || [...new Set(phones)].join(',') !== previewPhones) return
    const selected = [...new Set(phones)].filter(phone => !results.value[phone]?.checkedAt).slice(0, 10)
    confirmed.value = false
    await request('numbers-verify', selected)
  }
  return { capability, results, confirmed, busy, error, resetVerification, previewNumbers, verifyNumbers }
}
