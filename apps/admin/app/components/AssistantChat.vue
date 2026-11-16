<template>
  <div
    class="assistant-widget"
    :class="{ 'is-open': state.open, 'is-loading': loading || sending, 'has-error': Boolean(error) }"
    @keydown.esc.stop="close"
  >
    <section
      v-if="state.open"
      id="assistant-panel"
      class="assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="assistant-title"
    >
      <header class="assistant-header">
        <div>
          <h2 id="assistant-title">Assistente Zingara</h2>
          <p>Cria e organiza usando dados confirmados.</p>
        </div>
        <button class="assistant-close" type="button" aria-label="Fechar assistente" @click="close">×</button>
      </header>

      <div ref="messageList" class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text">
        <details v-if="events?.length" class="assistant-workflow">
          <summary>Preparar uma campanha</summary>
          <p>Escolha o evento e a etapa. A aprovação e a retomada exigem revisão humana no painel.</p>
          <label for="assistant-campaign-event">Evento da campanha</label>
          <select id="assistant-campaign-event" v-model="workflowEventId">
            <option value="">Selecione um evento</option><option v-for="event in events" :key="event.id" :value="event.id">{{ event.name }}</option>
          </select>
          <p v-if="workflowEvent">{{ workflowEvent.status === 'cancelled' ? 'O evento está cancelado.' : workflowEvent.publishedTemplateVersion ? `Modelo publicado: versão ${workflowEvent.publishedTemplateVersion}.` : 'Publique o modelo antes de preparar os envios.' }}</p>
          <div class="assistant-workflow-actions"><button v-for="step in campaignSteps" :key="step.id" type="button" :disabled="!workflowEvent || sending || loading" @click="openWorkflow(step.id)">{{ step.label }}</button></div>
        </details>
        <p v-if="loading && !messages.length" class="assistant-empty">Carregando conversa…</p>
        <p v-else-if="!messages.length" class="assistant-empty">Diga o que deseja criar, consultar ou abrir.</p>
        <p
          v-for="message in messages"
          :key="`${message.createdAt}-${message.role}-${message.content}`"
          class="assistant-message"
          :class="{ 'is-user': message.role === 'user' }"
        >
          {{ message.content }}
        </p>
        <p v-if="error" class="assistant-message is-error" role="alert">{{ error }}</p>
      </div>

      <p v-if="sending" class="assistant-status is-loading" role="status">Analisando pedido…</p>
      <form class="assistant-form" @submit.prevent="submit">
        <label class="visually-hidden" for="assistant-input">Mensagem para o assistente</label>
        <textarea
          id="assistant-input"
          ref="input"
          v-model="state.message"
          class="assistant-input"
          rows="2"
          maxlength="2000"
          placeholder="Ex.: crie um convite do zero"
          spellcheck="true"
          :disabled="loading || sending"
          @keydown.enter.exact.prevent="submit"
        />
        <button
          class="assistant-send"
          type="submit"
          aria-label="Enviar mensagem"
          :disabled="loading || sending || !state.message.trim()"
        >
          <span aria-hidden="true">↑</span>
        </button>
      </form>
    </section>

    <button
      ref="trigger"
      class="assistant-trigger"
      type="button"
      aria-label="Abrir assistente"
      aria-controls="assistant-panel"
      :aria-expanded="state.open"
      @click="toggle"
    >
      <span aria-hidden="true">✦</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { campaignSteps, useAssistant, type CampaignStep } from '~/modules/private/assistant/useAssistant'

const props = defineProps<{
  organizationId: string
  csrfToken: string
  events?: Array<{ id: string; name: string; status: string; publishedTemplateVersion?: number }>
}>()

const emit = defineEmits<{
  navigation: [value: unknown]
}>()

const organizationId = computed(() => props.organizationId)
const csrfToken = computed(() => props.csrfToken)
const state = reactive({ open: false, message: '', loaded: false })
const input = ref<HTMLTextAreaElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const messageList = ref<HTMLElement | null>(null)
const workflowEventId = ref('')
const workflowEvent = computed(() => props.events?.find(event => event.id === workflowEventId.value))
function openWorkflow(step: CampaignStep) {
  if (workflowEvent.value) emit('navigation', { type: 'event', area: 'campaigns', eventId: workflowEvent.value.id, step })
}
const { messages, loading, sending, error, resetAssistant, loadAssistant, sendMessage } = useAssistant({ organizationId, csrfToken })

watch([() => messages.value.length, loading, sending, error], () => void scrollToLatest())
watch(organizationId, async () => {
  workflowEventId.value = ''
  state.message = ''
  state.loaded = false
  resetAssistant()
  if (!state.open) return
  await loadAssistant()
  state.loaded = !error.value
  await scrollToLatest()
  input.value?.focus()
})

async function scrollToLatest() {
  await nextTick()
  messageList.value?.scrollTo({ top: messageList.value.scrollHeight })
}

async function open() {
  state.open = true
  await nextTick()
  input.value?.focus()
  if (state.loaded) return
  await loadAssistant()
  state.loaded = !error.value
  await scrollToLatest()
  input.value?.focus()
}

async function close() {
  if (!state.open) return
  state.open = false
  await nextTick()
  trigger.value?.focus()
}

function toggle() {
  if (state.open) void close()
  else void open()
}

async function submit() {
  const content = state.message.trim()
  if (!content || loading.value || sending.value) return
  state.message = ''
  const navigation = await sendMessage(content)
  if (error.value) state.message = content
  else if (navigation) emit('navigation', navigation)
  await scrollToLatest()
}
</script>

<style lang="sass" scoped>
.assistant-workflow
  color: var(--design-text)
  font-size: 12px

  summary
    min-height: 44px
    padding: 12px 0
    cursor: pointer

  p
    margin: 8px 0
    line-height: 1.5

  label
    display: block
    margin: 8px 0

  select
    width: 100%
    min-height: 44px
    padding: 8px
    color: var(--design-text)
    background: var(--design-bg)
    border: 1px solid var(--design-border)
    border-radius: 8px
    font: inherit

.assistant-workflow-actions
  display: flex
  flex-wrap: wrap
  gap: 8px
  margin: 12px 0

  button
    min-height: 44px
    padding: 8px 12px
    color: var(--design-accent)
    background: var(--design-bg)
    border: 1px solid var(--design-border)
    border-radius: 8px
    cursor: pointer
    font: inherit

.assistant-workflow :is(summary, select, button):focus-visible
  outline: 3px solid var(--design-accent)
  outline-offset: 2px
</style>
