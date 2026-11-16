<script setup lang="ts">
import { canActivateEvolutionInstance, canPairEvolutionInstance, evolutionQrActionLabel, evolutionQrImageSrc, linkableEvolutionInstances, type EvolutionInventoryItem } from '~/utils/evolution-console'

type Channel = 'baileys' | 'cloud'
type Installation = { baseUrl: string; verifiedAt: string; controlEnabled?: boolean }
type Status = { state: string; phone?: string; qrCode?: string; mode?: 'fake' | 'real' }
type Template = { type: string; name: string; language: string; status: string }

const props = defineProps<{
  organizationName?: string
  installation: Installation | null
  inventory: EvolutionInventoryItem[]
  statuses: Record<string, Status>
  templates: Record<string, Template[]>
  activeConnectionId?: string
  busy?: boolean
  error?: string
  notice?: string
  pairing?: { connectionId: string; remainingSeconds: number } | null
}>()
const emit = defineEmits<{
  refresh: []
  create: [data: { channel: 'baileys' } | { channel: 'cloud'; metaToken: string; phoneNumberId: string; businessId: string }]
  link: [data: { channel: 'baileys'; instanceName: string; token: string; confirm: true } | { channel: 'cloud'; instanceName: string; token: string; phoneNumberId: string; businessId: string; confirm: true }]
  status: [localId: string]
  connect: [localId: string]
  numberCheck: [data: { localId: string; phone: string }]
  saveTemplate: [data: { localId: string; type: string; name: string; language: string }]
  activate: [localId: string]
  stopPairing: []
}>()

onUnmounted(() => emit('stopPairing'))

const channel = ref<Channel>('baileys')
const metaToken = ref('')
const phoneNumberId = ref('')
const businessId = ref('')
const linkName = ref('')
const linkToken = ref('')
const linkConfirmed = ref(false)
const linkPhoneNumberId = ref('')
const linkBusinessId = ref('')
const phones = ref<Record<string, string>>({})
const templateType = ref('initial')
const templateName = ref('')
const templateLanguage = ref('pt_BR')
const pendingOperation = ref<'create' | null>(null)

const linkableInstances = computed(() => linkableEvolutionInstances(props.inventory))
const selectedLinkInstance = computed(() => linkableInstances.value.find(item => item.instanceName === linkName.value))
watch(() => props.busy, value => { if (!value) pendingOperation.value = null })
watch(() => props.inventory, items => {
  if (linkName.value && !linkableEvolutionInstances(items).some(item => item.instanceName === linkName.value)) {
    linkName.value = ''
    linkToken.value = ''
    linkConfirmed.value = false
    linkPhoneNumberId.value = ''
    linkBusinessId.value = ''
  }
})

function createInstance() {
  if (props.busy || pendingOperation.value) return
  pendingOperation.value = 'create'
  if (channel.value === 'baileys') emit('create', { channel: 'baileys' })
  else {
    emit('create', { channel: 'cloud', metaToken: metaToken.value, phoneNumberId: phoneNumberId.value.trim(), businessId: businessId.value.trim() })
    metaToken.value = ''
  }
}
function linkInstance() {
  const selected = selectedLinkInstance.value
  if (!linkConfirmed.value || !selected || !linkToken.value) return
  if (selected.channel === 'cloud') {
    if (!linkPhoneNumberId.value || !linkBusinessId.value) return
    emit('link', { channel: 'cloud', instanceName: selected.instanceName, token: linkToken.value,
      phoneNumberId: linkPhoneNumberId.value.trim(), businessId: linkBusinessId.value.trim(), confirm: true })
  } else if (selected.channel === 'baileys') {
    emit('link', { channel: 'baileys', instanceName: selected.instanceName, token: linkToken.value, confirm: true })
  }
  linkToken.value = ''
  linkConfirmed.value = false
  linkName.value = ''
  linkPhoneNumberId.value = ''
  linkBusinessId.value = ''
}
function stateLabel(state: string) {
  return ({ disconnected: 'Desconectada', connecting: 'Aguardando pareamento', connected: 'Telefone conectado', reconnecting: 'Reconectando', ready: 'Instância criada', pending: 'Provisionando' } as Record<string, string>)[state] ?? state
}
function templateTypeLabel(type: string) {
  return ({ initial: 'Convite inicial', pending_reminder: 'Lembrete pendente', confirmation: 'Confirmação', receipt: 'Comprovante',
    event_change: 'Alteração de evento', event_cancellation: 'Cancelamento do evento', admin_summary: 'Resumo administrativo' } as Record<string, string>)[type] ?? 'Tipo não identificado'
}
</script>

<template>
  <section class="evolution-console" aria-labelledby="evolution-installation-title">
    <header class="evolution-console-heading">
      <div><span class="eyebrow">Configurações · WhatsApp</span><h2 id="evolution-installation-title">Instalação Evolution</h2><p>Gerencie as instâncias de {{ organizationName || 'sua organização' }} pela instalação conectada à API.</p></div>
      <button class="button quiet" type="button" :disabled="busy || !installation" @click="emit('refresh')">Atualizar inventário</button>
    </header>

    <p v-if="error" class="form-message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="form-message success" role="status">{{ notice }}</p>

    <section class="panel evolution-console-panel">
      <div class="evolution-console-section-heading"><h3>Servidor</h3><span class="status-chip">{{ installation ? 'Servidor autenticado' : 'Aguardando autenticação' }}</span></div>
      <p v-if="installation?.verifiedAt" class="evolution-console-hint">Última verificação: {{ new Date(installation.verifiedAt).toLocaleString('pt-BR') }}.</p>
      <p v-else-if="!error" class="evolution-console-hint">Configure EVOLUTION_BASE_URL e EVOLUTION_API_KEY somente na API/Dokploy.</p>
      <p v-else class="evolution-console-hint">A configuração não pôde ser verificada enquanto a Evolution está indisponível.</p>
      <p v-if="installation && installation.controlEnabled === false" class="form-message" role="status">A instalação está conectada. A criação e o pareamento aguardam liberação no servidor.</p>
    </section>

    <section class="panel evolution-console-panel" aria-labelledby="evolution-inventory-title">
      <div class="evolution-console-section-heading"><div><h3 id="evolution-inventory-title">Inventário de instâncias</h3><p class="evolution-console-hint">Todas as instâncias aparecem aqui. Somente as próprias podem ser operadas.</p></div><span class="count-pill">{{ inventory.length }}</span></div>
      <p v-if="!inventory.length" class="empty-inline">{{ installation ? 'Nenhuma instância disponível nesta instalação.' : error ? 'Inventário indisponível enquanto a conexão não responde.' : 'A instalação Evolution ainda não está configurada na API.' }}</p>
      <ul v-else class="evolution-console-list">
        <li v-for="instance in inventory" :key="instance.instanceName" class="evolution-console-item">
          <div class="evolution-console-item-heading"><div><strong>{{ instance.instanceName }}</strong><small>{{ instance.channel === 'baileys' ? 'WhatsApp Baileys' : instance.channel === 'cloud' ? 'WhatsApp Cloud API' : 'Canal desconhecido' }}</small></div><span class="status-chip" :class="{ 'evolution-protected': instance.ownership === 'protegida' }">{{ instance.ownership === 'protegida' ? 'Protegida' : 'Própria' }}</span></div>
          <p>Estado: <strong>{{ stateLabel(instance.connectionId ? (statuses[instance.connectionId]?.state || instance.state) : instance.state) }}</strong><span v-if="instance.maskedNumber"> · Número {{ instance.maskedNumber }}</span></p>
          <p v-if="instance.ownership === 'protegida'" class="evolution-console-hint">Sessão de outra aplicação. Apenas metadados estão visíveis.</p>
          <template v-else-if="instance.connectionId">
            <div class="evolution-console-actions"><button class="button quiet" type="button" :disabled="busy" @click="emit('status', instance.connectionId!)">Atualizar estado</button><button v-if="activeConnectionId !== instance.connectionId" class="button quiet" type="button" :disabled="busy || !canActivateEvolutionInstance(instance)" @click="emit('activate', instance.connectionId!)">Tornar ativa</button><span v-else class="status-chip">Ativa</span><span v-if="statuses[instance.connectionId]?.mode === 'fake'" class="status-chip">Fake local</span></div>
            <template v-if="instance.channel === 'baileys'">
              <ol class="evolution-console-hint"><li>Abra WhatsApp no telefone e entre em Dispositivos conectados.</li><li>Escolha Conectar dispositivo e escaneie o QR exibido.</li><li>Aguarde o estado Telefone conectado. Tornar ativa apenas seleciona a instância para a organização.</li></ol>
              <p class="evolution-console-hint">Ao iniciar, acompanhamos a conexão e buscamos o QR vigente por até cinco minutos. Cada QR tem validade definida pela Evolution e pode mudar antes disso.</p>
              <button class="button primary" type="button" :disabled="busy || installation?.controlEnabled === false || !canPairEvolutionInstance(instance, statuses[instance.connectionId]?.state)" @click="emit('connect', instance.connectionId!)">{{ evolutionQrActionLabel(statuses[instance.connectionId]?.state || instance.state, !!statuses[instance.connectionId]?.qrCode) }}</button>
              <div v-if="pairing?.connectionId === instance.connectionId"><p>Acompanhamento automático: {{ Math.floor(pairing.remainingSeconds / 60) }}:{{ String(pairing.remainingSeconds % 60).padStart(2, '0') }} restantes. O QR atual será substituído quando a Evolution devolver outro.</p><p v-if="!statuses[instance.connectionId]?.qrCode" role="status">Aguardando QR da Evolution. Mantenha esta tela aberta.</p><button class="button quiet" type="button" @click="emit('stopPairing')">Parar acompanhamento</button></div>
              <div v-if="statuses[instance.connectionId]?.qrCode" class="evolution-console-qr" aria-live="polite"><h4>QR temporário</h4><img v-if="evolutionQrImageSrc(statuses[instance.connectionId]?.qrCode)" :src="evolutionQrImageSrc(statuses[instance.connectionId]?.qrCode)" alt="QR temporário da instância Baileys"><textarea v-else :value="statuses[instance.connectionId]?.qrCode" rows="3" readonly aria-label="Conteúdo do QR Baileys"></textarea></div>
              <form class="evolution-console-inline" @submit.prevent="emit('numberCheck', { localId: instance.connectionId!, phone: phones[instance.connectionId!] || '' })"><label :for="`evolution-phone-${instance.connectionId}`">Consultar número no WhatsApp</label><div><input :id="`evolution-phone-${instance.connectionId}`" v-model.trim="phones[instance.connectionId]" type="tel" pattern="\+?[1-9][0-9]{7,14}" placeholder="+5567999999999" required><button class="button quiet" type="submit" :disabled="busy || statuses[instance.connectionId]?.state !== 'connected'">Consultar número</button></div></form>
            </template>
            <template v-else>
              <p class="evolution-console-hint">Cloud API: confirme token Meta, Phone Number ID, Business ID, webhook e templates aprovados. Este canal não usa QR nem consulta a existência de números.</p>
              <h4>Templates oficiais</h4><p v-if="!templates[instance.connectionId]?.length" class="empty-inline">Nenhum template configurado.</p><ul v-else class="evolution-console-templates"><li v-for="item in templates[instance.connectionId]" :key="`${item.type}-${item.language}`">{{ templateTypeLabel(item.type) }} · {{ item.name }} ({{ item.language }}) · {{ item.status }}</li></ul>
              <form class="evolution-console-inline" @submit.prevent="emit('saveTemplate', { localId: instance.connectionId!, type: templateType, name: templateName.trim(), language: templateLanguage.trim() })"><label :for="`evolution-template-${instance.connectionId}`">Nome do template aprovado pela Meta</label><input :id="`evolution-template-${instance.connectionId}`" v-model.trim="templateName" required maxlength="512"><label :for="`evolution-language-${instance.connectionId}`">Idioma</label><input :id="`evolution-language-${instance.connectionId}`" v-model.trim="templateLanguage" required maxlength="16"><label :for="`evolution-use-${instance.connectionId}`">Uso</label><select :id="`evolution-use-${instance.connectionId}`" v-model="templateType"><option value="initial">Convite inicial</option><option value="pending_reminder">Lembrete</option><option value="confirmation">Confirmação</option><option value="receipt">Comprovante</option><option value="event_change">Alteração de evento</option><option value="event_cancellation">Cancelamento</option><option value="admin_summary">Resumo administrativo</option></select><button class="button quiet" type="submit" :disabled="busy">Salvar template</button></form>
            </template>
          </template>
        </li>
      </ul>
    </section>

    <div class="evolution-console-bottom">
      <form class="panel evolution-console-panel" @submit.prevent="createInstance"><h3>Criar instância própria</h3><label for="evolution-new-channel">Canal da nova instância</label><select id="evolution-new-channel" v-model="channel"><option value="baileys">WhatsApp Baileys (QR)</option><option value="cloud">WhatsApp Cloud API (Meta)</option></select><template v-if="channel === 'cloud'"><p class="evolution-console-hint">Configure primeiro o número e webhook na Meta. Templates dependem de aprovação.</p><label for="evolution-new-meta-token">Token Meta</label><input id="evolution-new-meta-token" v-model="metaToken" type="password" autocomplete="new-password" required maxlength="4096"><label for="evolution-new-phone-id">Phone Number ID</label><input id="evolution-new-phone-id" v-model.trim="phoneNumberId" inputmode="numeric" pattern="[0-9]+" required maxlength="32"><label for="evolution-new-business-id">Business ID</label><input id="evolution-new-business-id" v-model.trim="businessId" inputmode="numeric" pattern="[0-9]+" required maxlength="32"></template><button class="button primary" type="submit" :disabled="busy || !installation || installation.controlEnabled === false">{{ busy && pendingOperation === 'create' ? 'Criando…' : 'Criar instância' }}</button></form>
      <form class="panel evolution-console-panel" @submit.prevent="linkInstance"><h3>Vincular instância existente</h3><p class="evolution-console-hint">Somente instâncias com nome Zingara podem ser vinculadas. O vínculo exige token exato e não altera a sessão remota.</p><p v-if="!linkableInstances.length" class="empty-inline">Nenhuma instância Zingara disponível para vínculo.</p><template v-else><label for="evolution-existing-name">Instância Zingara sem vínculo</label><select id="evolution-existing-name" v-model="linkName" required><option value="">Selecione</option><option v-for="item in linkableInstances" :key="item.instanceName" :value="item.instanceName">{{ item.instanceName }}</option></select><label for="evolution-existing-token">Token da instância</label><input id="evolution-existing-token" v-model="linkToken" type="password" autocomplete="new-password" required maxlength="4096"><template v-if="selectedLinkInstance?.channel === 'cloud'"><label for="evolution-existing-phone-id">Phone Number ID</label><input id="evolution-existing-phone-id" v-model.trim="linkPhoneNumberId" inputmode="numeric" pattern="[0-9]{5,30}" required maxlength="30"><label for="evolution-existing-business-id">Business ID</label><input id="evolution-existing-business-id" v-model.trim="linkBusinessId" inputmode="numeric" pattern="[0-9]{5,30}" required maxlength="30"></template><label class="evolution-console-check"><input v-model="linkConfirmed" type="checkbox" required> Confirmo que esta instância pertence ao Zingara.</label><button class="button quiet" type="submit" :disabled="busy || !linkName || !linkConfirmed">Confirmar vínculo</button></template></form>
    </div>
    <p class="evolution-console-hint">Criar ou conectar uma instância não inicia envios. Consentimento, prévia e aprovação continuam obrigatórios.</p>
  </section>
</template>

<style scoped lang="sass">
@use "../assets/evolution-console"
</style>
