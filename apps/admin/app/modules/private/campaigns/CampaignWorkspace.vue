<script setup lang="ts">
import { EVENT_TIME_ZONES, localDateTime } from '~/modules/private/events/date-time'
import ContactImportPanel from './ContactImportPanel.vue'
import { campaignSteps, type CampaignStep } from '../assistant/useAssistant'
import { useCampaigns, type CampaignEvent } from './useCampaigns'
import { numberStateLabel, useNumberVerification } from './useNumberVerification'

const props = defineProps<{ organizationId: string; csrfToken: string; event: CampaignEvent; initialStep?: CampaignStep; active?: boolean }>()
const emit = defineEmits<{ close: []; template: []; guests: []; connection: []; step: [value: CampaignStep] }>()
const step = ref<CampaignStep>(props.initialStep ?? 'import')
const previewIndex = ref(0)
const {
  guests, guestTotal, guestPage, guestQuery, selectedGuests, campaigns, currentCampaign, historyLoadedAt, preview, intervalMs, sendTiming, scheduledLocal, latestSafeStart,
  reviewConfirmed, resumeConfirmed, cancelConfirmed,
  connection, connectionState, busy, error, notice, blockers, invitationFor, recipientBlocker, resetCampaigns, selectGuest, setInterval,
  setSendTiming, setScheduledLocal, loadCampaignData, prepareInvitations, createPreview, approveCampaign, refreshCampaign, pauseCampaign, resumeCampaign,
  cancelCampaign, reopenDraft, invalidatePreview,
} = useCampaigns({ organizationId: computed(() => props.organizationId), csrfToken: computed(() => props.csrfToken), event: computed(() => props.event) })
const { capability, results, confirmed, busy: verifying, error: verificationError, resetVerification, previewNumbers, verifyNumbers } = useNumberVerification({
  organizationId: computed(() => props.organizationId), csrfToken: computed(() => props.csrfToken), connection,
})
const selectedPhones = computed(() => selectedGuests.value.map(guest => guest.phone))
const previewItem = computed(() => preview.value?.items[previewIndex.value])
const blockedNumbers = computed(() => selectedGuests.value.some(guest => ['not_registered', 'invalid_format'].includes(results.value[guest.phone]?.state ?? '')))
const campaignLabels: Record<string, string> = { draft: 'Rascunho sem aprovação', scheduled: 'Agendada', running: 'Em processamento', paused: 'Pausada', completed: 'Processamento concluído', cancelled: 'Cancelada' }
const deliveryLabels: Record<string, string> = { queued: 'Na fila', processing: 'Em processamento', retry_wait: 'Aguardando tentativa', uncertain: 'Incerto: exige revisão', suppressed: 'Suprimido', completed: 'Aceito pelo provedor', failed_permanent: 'Falha permanente', pending: 'Pendente', accepted: 'Aceito pelo provedor', skipped: 'Não se aplica' }
const campaignStatus = (status: string) => campaignLabels[status] ?? status
const deliveryStatus = (status: string) => deliveryLabels[status] ?? status
const recipientSummary = (count: number) => `${count} ${count === 1 ? 'destinatário' : 'destinatários'}`
const formatDate = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: props.event.timeZone })
const scheduleMinimum = computed(() => localDateTime(new Date(Date.now() + 60_000).toISOString(), props.event.timeZone))
const cancellable = computed(() => currentCampaign.value && ['draft', 'scheduled', 'running', 'paused'].includes(currentCampaign.value.status))
const eventTimeZoneLabel = computed(() => {
  const zone = EVENT_TIME_ZONES.find(item => item.value === props.event.timeZone)
  if (zone) return `Horário de ${zone.label}`
  if (['UTC', 'Etc/UTC', 'Etc/GMT'].includes(props.event.timeZone)) return 'Horário universal'
  return `Horário de ${props.event.timeZone.split('/').at(-1)!.replaceAll('_', ' ')}`
})

watch(() => props.initialStep, value => { if (value) step.value = value })
watch(step, value => emit('step', value))
watch(() => selectedPhones.value.join(','), resetVerification)
watch(() => `${connection.value?.connectionId}:${connection.value?.revision}`, resetVerification)
watch(preview, () => { previewIndex.value = 0 })
watch(() => [props.event.publishedTemplateVersion, props.event.status], invalidatePreview)
watch(() => props.active, value => { if (value) void loadCampaignData() })
onMounted(loadCampaignData)
onBeforeUnmount(() => { resetCampaigns(); resetVerification() })
async function pageGuests(page: number) { guestPage.value = page; await loadCampaignData() }
async function searchGuests() { guestPage.value = 1; await loadCampaignData() }
async function approve() { await approveCampaign(); if (['scheduled', 'running'].includes(currentCampaign.value?.status ?? '')) step.value = 'monitor' }
async function prepare() { await createPreview(); if (preview.value) step.value = 'review' }
async function reviewDraft() { await reopenDraft(); if (preview.value) step.value = 'review' }
function safeLink(link: string) { try { const url = new URL(link); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined } catch { return undefined } }
</script>

<template>
  <section class="campaign-workspace" aria-labelledby="campaign-title">
    <header class="campaign-heading"><div><span class="eyebrow">Campanha de convites</span><h2 id="campaign-title">{{ event.name }}</h2>
      <p>Prepare a lista, confira o conteúdo e acompanhe cada tentativa.</p></div><button class="button quiet" type="button" @click="emit('close')">Voltar aos eventos</button></header>
    <nav class="campaign-steps" aria-label="Etapas da campanha"><button v-for="(item, index) in campaignSteps" :key="item.id" type="button" :aria-current="step === item.id ? 'step' : undefined" @click="step = item.id"><span aria-hidden="true">{{ index + 1 }}</span>{{ item.label }}</button></nav>
    <p v-if="error" class="form-message error" role="alert">{{ error }}</p><p v-if="notice" class="form-message success" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">Atualizando os dados da campanha…</p>

    <template v-if="step === 'import'">
      <ContactImportPanel :organization-id="organizationId" :csrf-token="csrfToken" @imported="loadCampaignData" />
      <button class="button primary" type="button" @click="step = 'verify'">Escolher e verificar contatos</button>
    </template>

    <template v-else-if="step === 'verify'">
      <section class="campaign-panel" aria-labelledby="campaign-recipients-title">
        <div class="campaign-heading"><div><span class="eyebrow">Destinatários</span><h3 id="campaign-recipients-title">Escolher contatos</h3><p>{{ recipientSummary(selectedGuests.length) }} na seleção · máximo de 200 por campanha.</p></div>
          <button class="button quiet" type="button" :disabled="busy || verifying" @click="loadCampaignData">Atualizar contatos e conexão</button></div>
        <form class="campaign-search" role="search" @submit.prevent="searchGuests"><label for="campaign-guest-query">Buscar contato por nome ou telefone</label><div class="campaign-actions"><input id="campaign-guest-query" v-model="guestQuery" type="search" maxlength="100"><button class="button quiet" :disabled="busy" type="submit">Buscar contatos</button></div></form>
        <div v-if="guests.length" class="campaign-table-scroll" tabindex="0" role="region" aria-label="Contatos da campanha"><table class="campaign-table">
          <caption class="visually-hidden">Selecione contatos para verificar e preparar os convites</caption><thead><tr><th scope="col">Selecionar</th><th scope="col">Contato</th><th scope="col">Consentimento e convite</th><th scope="col">Consulta WhatsApp</th></tr></thead>
          <tbody><tr v-for="guest in guests" :key="guest.id"><td><input type="checkbox" :aria-label="`Selecionar ${guest.name}`" :checked="selectedGuests.some(item => item.id === guest.id)" :disabled="busy || verifying || (selectedGuests.length >= 200 && !selectedGuests.some(item => item.id === guest.id))" @change="selectGuest(guest, ($event.target as HTMLInputElement).checked)"></td>
            <td><strong>{{ guest.name }}</strong><small>{{ guest.phone }}</small></td><td>{{ recipientBlocker(guest) || 'Consentimento registrado; convite pendente' }}</td>
            <td>{{ numberStateLabel(results[guest.phone]?.state) }}<small v-if="results[guest.phone]?.checkedAt">{{ formatDate(results[guest.phone]!.checkedAt!) }} · {{ capability?.mode === 'fake' ? 'Simulado' : 'Consulta real' }}</small></td></tr></tbody>
        </table></div><p v-else>Nenhum contato encontrado. Importe uma lista ou revise a busca.</p>
        <div class="campaign-actions"><button class="button quiet" type="button" :disabled="busy || guestPage <= 1" @click="pageGuests(guestPage - 1)">Página anterior</button><span>Página {{ guestPage }} de {{ Math.max(1, Math.ceil(guestTotal / 100)) }}</span><button class="button quiet" type="button" :disabled="busy || guestPage * 100 >= guestTotal" @click="pageGuests(guestPage + 1)">Próxima página</button></div>
        <div v-if="selectedGuests.length" class="campaign-selection"><h4>Seleção completa</h4><ul><li v-for="guest in selectedGuests" :key="guest.id">{{ guest.name }} · {{ guest.phone }}<button class="button quiet" type="button" :aria-label="`Remover ${guest.name} da campanha`" :disabled="busy || verifying" @click="selectGuest(guest, false)">Remover</button></li></ul></div>
        <div class="campaign-actions"><button class="button quiet" type="button" @click="emit('guests')">Revisar cadastro e consentimento</button><button class="button primary" type="button" :disabled="busy || !event.publishedTemplateVersion || !selectedGuests.some(guest => !invitationFor(guest.id))" @click="prepareInvitations">Preparar convites selecionados</button></div>
      </section>
      <section class="campaign-panel" aria-labelledby="campaign-verification-title" :aria-busy="verifying">
        <h3 id="campaign-verification-title">Verificar números no WhatsApp</h3><p>A consulta não registra consentimento nem envia convites.</p>
        <p>Conexão: {{ connection ? `${connection.channel === 'cloud' ? 'Cloud API' : 'Baileys'} · ${connectionState === 'connected' ? 'Conectada' : 'Não conectada'}` : 'Nenhuma conexão ativa' }}.</p>
        <button v-if="!connection || connectionState !== 'connected'" class="button quiet" type="button" @click="emit('connection')">Abrir conexão WhatsApp</button>
        <button class="button quiet" type="button" :disabled="busy || verifying || !connection || !selectedGuests.length" @click="previewNumbers(selectedPhones)">Preparar consulta dos selecionados</button>
        <p v-if="verificationError" class="form-message error" role="alert">{{ verificationError }}</p>
        <template v-if="capability"><p>{{ capability.mode === 'fake' ? 'Modo simulado: o resultado não comprova registro real.' : 'A consulta usa a conexão ativa da organização.' }}</p><p>Limites: {{ capability.limits.batch }} por lote, {{ capability.limits.perMinute }} por minuto e {{ capability.limits.perDay }} por dia.</p>
          <p v-if="!capability.lookupSupported">Este canal não oferece consulta de existência. O estado permanece inconclusivo.</p>
          <template v-else><label class="campaign-check" for="campaign-verify-confirm"><input id="campaign-verify-confirm" v-model="confirmed" type="checkbox" :disabled="verifying"> Confirmo consultar até 10 números selecionados pela conexão {{ capability.connection.instanceName }}.</label><button class="button primary" type="button" :disabled="!confirmed || verifying || busy" @click="verifyNumbers(selectedPhones)">{{ verifying ? 'Consultando…' : 'Consultar próximo lote de até 10' }}</button></template>
        </template>
      </section>
      <button class="button primary" type="button" @click="step = 'message'">Continuar para mensagem</button>
    </template>

    <section v-else-if="step === 'message'" class="campaign-panel" aria-labelledby="campaign-message-title"><span class="eyebrow">Conteúdo publicado</span><h3 id="campaign-message-title">Preparar a mensagem do evento</h3>
      <p>Edite o texto WhatsApp no modelo do evento. Publique a versão antes de gerar a prévia da campanha.</p><p>A arte permanece na página individual do convite. No WhatsApp, a campanha envia somente o texto e o link individual.</p><p>Nome, prazo e link serão resolvidos para cada convite emitido.</p>
      <p>{{ event.publishedTemplateVersion ? `Modelo publicado: versão ${event.publishedTemplateVersion}.` : 'Este evento ainda não tem um modelo publicado.' }}</p>
      <div class="campaign-actions"><button class="button quiet" type="button" @click="emit('template')">Editar modelo e mensagem</button><button class="button primary" type="button" @click="step = 'review'">Revisar campanha</button></div>
    </section>

    <section v-else-if="step === 'review'" class="campaign-panel" aria-labelledby="campaign-review-title"><span class="eyebrow">Aprovação humana</span><h3 id="campaign-review-title">Revisar antes de aprovar</h3>
      <p>{{ recipientSummary(selectedGuests.length) }} na seleção · {{ connection?.channel === 'cloud' ? 'Cloud API' : 'Baileys' }} · fuso {{ eventTimeZoneLabel }}.</p>
      <label for="campaign-interval">Intervalo mínimo entre tentativas (segundos)</label><input id="campaign-interval" type="number" min="2" max="3600" step="1" :value="intervalMs / 1000" :disabled="busy" @input="setInterval(Number(($event.target as HTMLInputElement).value) * 1000)">
      <p>A cadência reduz rajadas de mensagens, mas não garante proteção contra bloqueio. Consentimento, conteúdo e regras da Meta continuam necessários.</p>
      <fieldset><legend>Quando iniciar</legend>
        <label class="campaign-check"><input name="campaign-timing" type="radio" value="immediate" :checked="sendTiming === 'immediate'" :disabled="busy" @change="setSendTiming('immediate')"> Iniciar após a aprovação</label>
        <label class="campaign-check"><input name="campaign-timing" type="radio" value="scheduled" :checked="sendTiming === 'scheduled'" :disabled="busy" @change="setSendTiming('scheduled')"> Agendar para outro horário</label>
      </fieldset>
      <template v-if="sendTiming === 'scheduled'"><label for="campaign-scheduled-at">Data e hora do início</label><input id="campaign-scheduled-at" type="datetime-local" :min="scheduleMinimum" :value="scheduledLocal" :disabled="busy" @input="setScheduledLocal(($event.target as HTMLInputElement).value)"><small>{{ eventTimeZoneLabel }}. A campanha não iniciará antes deste horário.</small><p v-if="latestSafeStart">Com {{ recipientSummary(selectedGuests.length) }} e este intervalo, agende o início antes de {{ formatDate(latestSafeStart) }}. Assim, a última tentativa fica antes do prazo de resposta ou da validade mais curta dos convites.</p></template>
      <ul v-if="blockers.length || blockedNumbers" class="campaign-blockers"><li v-for="blocker in blockers" :key="blocker">{{ blocker }}</li><li v-if="blockedNumbers">Há números inválidos ou não registrados na consulta. Revise a seleção.</li></ul>
      <div class="campaign-actions"><button class="button quiet" type="button" @click="step = 'verify'">Revisar seleção</button><button class="button primary" type="button" :disabled="busy || Boolean(blockers.length) || blockedNumbers" @click="prepare">Gerar prévia da campanha</button></div>
      <template v-if="preview && currentCampaign"><p class="campaign-mode"><strong>{{ currentCampaign.approvedMode === 'fake' ? 'Campanha simulada' : 'Campanha real' }}</strong> · {{ recipientSummary(preview.items.length) }} · intervalo {{ preview.intervalMs / 1000 }} segundos · {{ currentCampaign.scheduledAt ? `início em ${formatDate(currentCampaign.scheduledAt)} (${eventTimeZoneLabel})` : 'início após aprovação' }}.</p>
        <p>Conexão selecionada: {{ capability?.connection.instanceName || connection?.connectionId }} · revisão {{ connection?.revision }}.</p>
        <p v-if="previewItem?.officialTemplate">Template oficial aprovado: {{ previewItem.officialTemplate.name }} ({{ previewItem.officialTemplate.language }}) · revisão {{ previewItem.officialTemplate.revision }}.</p>
        <label for="campaign-preview-recipient">Revisar texto e link de cada destinatário</label><select id="campaign-preview-recipient" v-model="previewIndex"><option v-for="(item, index) in preview.items" :key="item.invitationId" :value="index">{{ index + 1 }}. {{ item.recipient.name }} · {{ item.recipient.phone }}</option></select>
        <article v-if="previewItem" class="campaign-message-preview" aria-label="Mensagem individual revisada"><strong>{{ previewItem.recipient.name }} · {{ previewItem.recipient.phone }}</strong><p>{{ previewItem.text }}</p><a v-if="safeLink(previewItem.link)" :href="safeLink(previewItem.link)" target="_blank" rel="noopener noreferrer">{{ previewItem.link }}</a></article>
        <label class="campaign-check" for="campaign-approval-confirm"><input id="campaign-approval-confirm" v-model="reviewConfirmed" type="checkbox" :disabled="busy"> Revisei {{ recipientSummary(preview.items.length) }}, os textos, links, canal, intervalo e {{ currentCampaign.scheduledAt ? `agendamento para ${formatDate(currentCampaign.scheduledAt)}` : 'início imediato após aprovação' }}. Aprovo esta campanha {{ currentCampaign.approvedMode === 'fake' ? 'simulada' : 'real' }}.</label>
        <button class="button primary" type="button" :disabled="!reviewConfirmed || busy || Boolean(blockers.length) || blockedNumbers" @click="approve">{{ currentCampaign.approvedMode === 'fake' ? 'Aprovar campanha simulada' : 'Aprovar campanha real' }}</button>
      </template>
    </section>

    <section v-else class="campaign-panel" aria-labelledby="campaign-monitor-title"><div class="campaign-heading"><div><span class="eyebrow">Histórico</span><h3 id="campaign-monitor-title">Acompanhar campanhas</h3><p>Os estados abaixo refletem o processamento. Aceitação do provedor não confirma entrega ou leitura.</p></div><button class="button quiet" type="button" :disabled="busy" @click="loadCampaignData">Atualizar campanhas</button></div>
      <p v-if="!campaigns.length">Nenhuma campanha registrada para este evento. Gere uma prévia para começar.</p>
      <ul v-else class="campaign-list"><li v-for="campaign in campaigns" :key="campaign.id"><div><strong>{{ campaignStatus(campaign.status) }}</strong><small>{{ recipientSummary(campaign.recipientCount) }} · {{ campaign.approvedMode === 'fake' ? 'Simulada' : 'Real' }} · {{ campaign.intervalMs / 1000 }} segundos<span v-if="campaign.scheduledAt"> · {{ formatDate(campaign.scheduledAt) }} ({{ eventTimeZoneLabel }})</span></small></div><button class="button quiet" type="button" :disabled="busy" @click="refreshCampaign(campaign.id)">Abrir campanha</button></li></ul>
      <article v-if="currentCampaign" class="campaign-detail"><h4>{{ campaignStatus(currentCampaign.status) }}</h4><p>Campanha {{ currentCampaign.id }} · {{ recipientSummary(currentCampaign.recipientCount) }}.</p>
        <p v-if="currentCampaign.scheduledAt">Início agendado para {{ formatDate(currentCampaign.scheduledAt) }} · {{ eventTimeZoneLabel }}.</p><p v-if="currentCampaign.cancelledAt">Cancelada em {{ formatDate(currentCampaign.cancelledAt) }} · {{ eventTimeZoneLabel }}.</p>
        <button class="button quiet" type="button" :disabled="busy" @click="refreshCampaign()">Atualizar estado</button><button v-if="currentCampaign.status === 'running'" class="button quiet" type="button" :disabled="busy" @click="pauseCampaign">Pausar campanha</button>
        <template v-if="currentCampaign.status === 'paused'"><label class="campaign-check" for="campaign-resume-confirm"><input id="campaign-resume-confirm" v-model="resumeConfirmed" type="checkbox" :disabled="busy"> Confirmo retomar o processamento desta campanha {{ currentCampaign.approvedMode === 'fake' ? 'simulada' : 'real' }}.</label><button class="button primary" type="button" :disabled="busy || !resumeConfirmed" @click="resumeCampaign">Retomar campanha</button></template>
        <template v-if="cancellable"><label class="campaign-check" for="campaign-cancel-confirm"><input id="campaign-cancel-confirm" v-model="cancelConfirmed" type="checkbox" :disabled="busy"> Confirmo o cancelamento definitivo. Nenhuma nova tentativa será iniciada.</label><button class="button quiet" type="button" :disabled="busy || !cancelConfirmed" @click="cancelCampaign">Cancelar campanha</button></template>
        <dl v-if="currentCampaign.counts" class="campaign-counts"><div v-for="(count, status) in currentCampaign.counts" :key="status"><dt>{{ deliveryStatus(status) }}</dt><dd>{{ count }}</dd></div></dl>
        <p v-if="currentCampaign.counts && historyLoadedAt">Histórico consultado em {{ formatDate(historyLoadedAt) }}.</p>
        <ul v-if="currentCampaign.items?.length" class="campaign-list"><li v-for="item in currentCampaign.items" :key="item.deliveryId"><div><strong>Convite {{ item.invitationId }}</strong><small>{{ deliveryStatus(item.status) }} · Mídia: {{ deliveryStatus(item.mediaStatus) }} · Texto: {{ deliveryStatus(item.textStatus) }}</small></div></li></ul>
        <template v-if="currentCampaign.status === 'draft'"><p>Este rascunho ainda não foi aprovado. Abra a revisão para conferir o conteúdo antes de aprovar.</p><button class="button primary" type="button" :disabled="busy" @click="reviewDraft">Reabrir revisão do rascunho</button></template>
      </article>
    </section>
  </section>
</template>

<style lang="sass" src="./campaigns.sass"></style>
