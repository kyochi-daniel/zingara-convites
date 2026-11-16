import { canPairEvolutionInstance, type EvolutionInventoryItem } from '../../../utils/evolution-console'

type RefLike<T> = { value: T }
type Installation = { baseUrl: string; verifiedAt: string; controlEnabled?: boolean }
type EvolutionStatus = { state: string; phone?: string; qrCode?: string; mode?: 'fake' | 'real' }
type OfficialTemplate = { type: string; name: string; language: string; status: string }
type ActiveConnection = { provider: 'evolution'; channel: 'baileys' | 'cloud'; connectionId: string; revision: number } | null
type CreateConnection = { channel: 'baileys' } | { channel: 'cloud'; metaToken: string; phoneNumberId: string; businessId: string }
type LinkConnection =
  | { channel: 'baileys'; instanceName: string; token: string; confirm: true }
  | { channel: 'cloud'; instanceName: string; token: string; phoneNumberId: string; businessId: string; confirm: true }

export function useEvolutionConsole(dependencies: {
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
}) {
  const installation = ref<Installation | null>(null)
  const inventory = ref<EvolutionInventoryItem[]>([])
  const activeConnection = ref<ActiveConnection>(null)
  const statuses = ref<Record<string, EvolutionStatus>>({})
  const templates = ref<Record<string, OfficialTemplate[]>>({})
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const notice = ref('')
  const pairing = ref<{ connectionId: string; remainingSeconds: number } | null>(null)
  let pairingRequest = 0
  let pairingTimer: ReturnType<typeof setTimeout> | undefined
  let pairingDeadline: ReturnType<typeof setInterval> | undefined
  let loadRequest = 0

  const headers = () => ({ 'x-csrf-token': dependencies.csrfToken.value })
  const organizationPath = (resource: string) => `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/${resource}`
  const evolutionPath = (resource = '') => organizationPath(`connections/evolution${resource ? `/${resource}` : ''}`)

  function stopEvolutionPairing() {
    pairingRequest += 1
    clearTimeout(pairingTimer)
    clearInterval(pairingDeadline)
    const localId = pairing.value?.connectionId
    if (localId && statuses.value[localId]) {
      const { qrCode: _qrCode, ...status } = statuses.value[localId]!
      statuses.value = { ...statuses.value, [localId]: status }
    }
    pairing.value = null
  }

  onScopeDispose(stopEvolutionPairing)

  function resetEvolutionOrganization() {
    stopEvolutionPairing()
    loadRequest += 1
    inventory.value = []
    activeConnection.value = null
    statuses.value = {}
    templates.value = {}
    error.value = ''
    notice.value = ''
  }

  async function refreshEvolutionStatus(localId: string) {
    const organizationId = dependencies.selectedOrganizationId.value
    const request = loadRequest
    const session = pairingRequest
    const result = await $fetch<{ status: EvolutionStatus }>(evolutionPath(`${encodeURIComponent(localId)}/status`))
    if (request !== loadRequest || session !== pairingRequest || organizationId !== dependencies.selectedOrganizationId.value) return
    const previous = statuses.value[localId]
    const status = result.status.state === 'connecting' && pairing.value?.connectionId === localId
      ? { ...previous, ...result.status } : result.status
    statuses.value = { ...statuses.value, [localId]: status }
    if (status.state === 'connected' && pairing.value?.connectionId === localId) {
      stopEvolutionPairing()
      notice.value = 'Telefone conectado. O pareamento foi concluído; nenhum envio foi iniciado.'
    }
  }

  async function refreshEvolutionTemplates(localId: string) {
    const result = await $fetch<{ templates: OfficialTemplate[] }>(evolutionPath(`${encodeURIComponent(localId)}/templates`))
    templates.value = { ...templates.value, [localId]: result.templates }
  }

  async function loadEvolutionArea() {
    const requestId = ++loadRequest
    const organizationId = dependencies.selectedOrganizationId.value
    loading.value = true
    error.value = ''
    try {
      const installationResult = await $fetch<{ installation: Installation | null }>('/api/admin/evolution/installation')
      installation.value = installationResult.installation
      if (requestId !== loadRequest || organizationId !== dependencies.selectedOrganizationId.value) return
      if (!installationResult.installation || !organizationId) {
        stopEvolutionPairing()
        inventory.value = []
        activeConnection.value = null
        statuses.value = {}
        templates.value = {}
        return
      }

      const [inventoryResult, activeResult] = await Promise.all([
        $fetch<{ instances: EvolutionInventoryItem[] }>(evolutionPath('instances')),
        $fetch<{ active: ActiveConnection }>(organizationPath('connections/active')),
      ])
      if (requestId !== loadRequest || organizationId !== dependencies.selectedOrganizationId.value) return
      inventory.value = inventoryResult.instances
      activeConnection.value = activeResult.active
      const nextStatuses: Record<string, EvolutionStatus> = {}
      const nextTemplates: Record<string, OfficialTemplate[]> = {}
      await Promise.all(inventoryResult.instances.map(async instance => {
        if (instance.ownership !== 'propria' || !instance.connectionId) return
        try {
          const result = await $fetch<{ status: EvolutionStatus }>(evolutionPath(`${encodeURIComponent(instance.connectionId)}/status`))
          nextStatuses[instance.connectionId] = result.status
        } catch { /* cada instância mantém seu próprio estado */ }
        if (instance.channel === 'cloud') {
          try {
            const result = await $fetch<{ templates: OfficialTemplate[] }>(evolutionPath(`${encodeURIComponent(instance.connectionId)}/templates`))
            nextTemplates[instance.connectionId] = result.templates
          } catch { nextTemplates[instance.connectionId] = [] }
        }
      }))
      if (requestId !== loadRequest || organizationId !== dependencies.selectedOrganizationId.value) return
      const pairingId = pairing.value?.connectionId
      if (pairingId && nextStatuses[pairingId]?.state === 'connecting') {
        nextStatuses[pairingId] = { ...statuses.value[pairingId], ...nextStatuses[pairingId] }
      }
      statuses.value = nextStatuses
      if (pairingId && (!inventory.value.some(item => item.connectionId === pairingId && canPairEvolutionInstance(item, nextStatuses[pairingId]?.state)) || installation.value?.controlEnabled === false)) {
        stopEvolutionPairing()
      }
      templates.value = nextTemplates
    } catch {
      if (requestId === loadRequest && organizationId === dependencies.selectedOrganizationId.value) {
        stopEvolutionPairing()
        installation.value = null
        inventory.value = []
        activeConnection.value = null
        statuses.value = {}
        templates.value = {}
        error.value = 'Não foi possível conectar à Evolution. Atualize a tela.'
      }
    } finally {
      if (requestId === loadRequest) loading.value = false
    }
  }

  async function createEvolutionConnection(data: CreateConnection) {
    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      await $fetch(evolutionPath(), { method: 'POST', headers: headers(), body: data })
      await loadEvolutionArea()
      notice.value = data.channel === 'baileys'
        ? 'Instância Baileys criada. Consulte o estado e pareie pelo QR temporário.'
        : 'Instância oficial criada. Confira o estado e os templates aprovados.'
    } catch {
      error.value = 'Não foi possível criar a instância. Confira os dados e tente novamente.'
    } finally {
      saving.value = false
    }
  }

  async function linkEvolutionConnection(data: LinkConnection) {
    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      await $fetch(evolutionPath('link'), { method: 'POST', headers: headers(), body: data })
      await loadEvolutionArea()
      notice.value = 'Instância vinculada à organização sem alterar a sessão remota.'
    } catch {
      error.value = 'Não foi possível vincular a instância. Confira o token e a confirmação de propriedade.'
    } finally {
      saving.value = false
    }
  }

  async function diagnoseEvolution(localId: string) {
    error.value = ''
    try { await refreshEvolutionStatus(localId) }
    catch { error.value = 'Não foi possível consultar o estado da instância.' }
  }

  async function connectEvolution(localId: string) {
    const instance = inventory.value.find(item => item.connectionId === localId)
    if (saving.value || !instance || installation.value?.controlEnabled === false || !canPairEvolutionInstance(instance, statuses.value[localId]?.state)) return
    stopEvolutionPairing()
    const request = pairingRequest
    const organizationId = dependencies.selectedOrganizationId.value
    const expiresAt = Date.now() + 300_000
    const path = evolutionPath(`${encodeURIComponent(localId)}/connect`)
    const current = () => request === pairingRequest && organizationId === dependencies.selectedOrganizationId.value
    pairing.value = { connectionId: localId, remainingSeconds: 300 }
    pairingDeadline = setInterval(() => {
      if (!current()) return
      const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      pairing.value = { connectionId: localId, remainingSeconds }
      if (!remainingSeconds) {
        stopEvolutionPairing()
        notice.value = 'O acompanhamento de cinco minutos terminou. Inicie novamente para buscar o QR atual.'
      }
    }, 1_000)

    const fetchQr = () => $fetch<{ status: EvolutionStatus }>(path, {
      method: 'POST', headers: headers(), body: {},
    })
    const acceptStatus = (status: EvolutionStatus) => {
      statuses.value = { ...statuses.value, [localId]: status }
      if (status.state === 'connected') {
        stopEvolutionPairing()
        notice.value = 'Telefone conectado. O pareamento foi concluído; nenhum envio foi iniciado.'
        return false
      }
      return true
    }
    const fail = () => {
      stopEvolutionPairing()
      error.value = 'Não foi possível acompanhar o pareamento. Consulte o estado e inicie novamente para buscar o QR atual.'
    }
    const schedule = () => {
      pairingTimer = setTimeout(async () => {
        if (!current()) return
        try {
          const result = await $fetch<{ status: EvolutionStatus }>(evolutionPath(`${encodeURIComponent(localId)}/status`))
          if (!current()) return
          if (result.status.state === 'connected') { acceptStatus(result.status); return }
          if (!canPairEvolutionInstance(instance, result.status.state)) { fail(); return }
          // The existing provider endpoint returns its current QR; the contract has no QR expiry timestamp.
          const qrResult = await fetchQr()
          if (!current()) return
          if (acceptStatus(qrResult.status)) schedule()
        } catch { if (current()) fail() }
      }, 5_000)
    }
    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      const result = await fetchQr()
      if (!current()) return
      if (acceptStatus(result.status)) {
        notice.value = 'Acompanhamento iniciado por até cinco minutos. O QR muda conforme a Evolution; escaneie o código exibido.'
        schedule()
      }
    } catch {
      if (current()) fail()
    } finally {
      saving.value = false
    }
  }

  async function checkEvolutionNumber(data: { localId: string; phone: string }) {
    saving.value = true
    error.value = ''
    try {
      const result = await $fetch<{ exists: boolean }>(evolutionPath(`${encodeURIComponent(data.localId)}/number-check`), {
        method: 'POST', headers: headers(), body: { phone: data.phone.trim() },
      })
      notice.value = result.exists ? 'Número encontrado no WhatsApp.' : 'Número não encontrado no WhatsApp.'
    } catch {
      error.value = 'Não foi possível consultar esse número. Tente novamente mais tarde.'
    } finally {
      saving.value = false
    }
  }

  async function selectActiveConnection(connectionId: string) {
    saving.value = true
    error.value = ''
    try {
      await $fetch(organizationPath('connections/active'), {
        method: 'PUT', headers: headers(),
        body: { provider: 'evolution', connectionId, revision: activeConnection.value?.revision ?? 0 },
      })
      await loadEvolutionArea()
      notice.value = 'Conexão ativa atualizada. Prévia e aprovação pendentes devem ser refeitas.'
    } catch {
      error.value = 'Não foi possível trocar a conexão ativa. Atualize a tela e tente novamente.'
    } finally {
      saving.value = false
    }
  }

  async function saveEvolutionTemplate(data: { localId: string; type: string; name: string; language: string }) {
    saving.value = true
    error.value = ''
    try {
      await $fetch(evolutionPath(`${encodeURIComponent(data.localId)}/templates`), {
        method: 'PUT', headers: headers(), body: { type: data.type, name: data.name, language: data.language },
      })
      await refreshEvolutionTemplates(data.localId)
      notice.value = 'Template salvo. O envio exige aprovação vigente pela Meta.'
    } catch {
      error.value = 'Template não foi aceito. Confira nome, idioma e aprovação na Meta.'
    } finally {
      saving.value = false
    }
  }

  return {
    installation,
    inventory,
    activeConnection,
    statuses,
    templates,
    loading,
    saving,
    error,
    notice,
    pairing,
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
  }
}
