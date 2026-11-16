<script setup lang="ts">
import '~/assets/_design-event-editor.sass'
import { DEFAULT_EVENT_TIME_ZONE, EVENT_TIME_ZONES } from '~/modules/private/events/date-time'

type EventForm = {
  name: string
  description: string
  location: string
  address: string
  startsAt: string
  endsAt: string
  rsvpDeadline: string
  timeZone: string
  companionLimit: number
  companionNamesRequired: boolean
}

type EventSummary = {
  invited: number
  confirmed: number
  confirmationRate: number
}

const props = defineProps<{
  eventForm: EventForm
  editingEventId: string | null
  saving: boolean
  eventStatus?: string
  summary?: EventSummary
}>()

const emit = defineEmits<{
  save: []
  cancel: []
}>()

const statusLabel = computed(() => ({
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
}[props.eventStatus ?? 'draft'] ?? props.eventStatus))

if (!props.editingEventId) props.eventForm.timeZone = DEFAULT_EVENT_TIME_ZONE

</script>

<template>
  <section class="design-event-editor">
    <header class="design-event-editor__heading">
      <div>
        <p class="design-event-editor__eyebrow">Eventos <span>/</span> {{ props.editingEventId ? 'Editar' : 'Novo' }}</p>
        <h1>{{ props.editingEventId ? 'Editar evento' : 'Novo evento' }}</h1>
        <p class="design-event-editor__subtitle">Personalize os detalhes e as configurações do convite.</p>
      </div>
      <div class="design-event-editor__actions">
        <button class="design-event-editor__button design-event-editor__button--quiet" type="button" @click="emit('cancel')">
          Cancelar
        </button>
        <button class="design-event-editor__button design-event-editor__button--save" type="submit" form="design-event-form" :disabled="props.saving">
          {{ props.saving ? 'Salvando…' : props.editingEventId ? 'Salvar alterações' : 'Criar evento' }}
        </button>
      </div>
    </header>

    <div class="design-event-editor__layout" :class="{ 'design-event-editor__layout--summary': props.summary }">
      <form id="design-event-form" class="design-event-editor__card design-event-editor__form" @submit.prevent="emit('save')">
        <div class="design-event-editor__hero" aria-hidden="true">
          <img src="/design/event/editor-art.jpg" alt="" />
        </div>

        <section class="design-event-editor__fields" aria-labelledby="design-event-details-title">
          <div class="design-event-editor__section-title">
            <div>
              <p class="design-event-editor__eyebrow">Detalhes</p>
              <h2 id="design-event-details-title">Informações do evento</h2>
            </div>
            <span class="design-event-editor__status">{{ statusLabel }}</span>
          </div>

          <p v-if="!props.editingEventId" class="design-event-editor__starter">O convite começa com o modelo genérico. Você poderá adaptar e visualizar o resultado antes de publicar.</p>

          <div class="design-event-editor__field">
            <label for="event-name">Nome do evento <span aria-hidden="true">*</span></label>
            <input id="event-name" v-model="props.eventForm.name" name="name" autocomplete="off" maxlength="120" required />
          </div>

          <div class="design-event-editor__field">
            <label for="event-description">Descrição</label>
            <textarea id="event-description" v-model="props.eventForm.description" name="description" rows="3" maxlength="2000" />
          </div>

          <div class="design-event-editor__field-row">
            <div class="design-event-editor__field">
              <label for="event-start">Data e hora de início <span aria-hidden="true">*</span></label>
              <input id="event-start" v-model="props.eventForm.startsAt" type="text" inputmode="numeric" name="startsAt" placeholder="2026-11-15T18:00" required />
            </div>
            <div class="design-event-editor__field">
              <label for="event-end">Data e hora de término <span aria-hidden="true">*</span></label>
              <input id="event-end" v-model="props.eventForm.endsAt" type="text" inputmode="numeric" name="endsAt" placeholder="2026-11-15T23:00" required />
            </div>
          </div>

          <div class="design-event-editor__field-row">
            <div class="design-event-editor__field">
              <label for="event-location">Local <span aria-hidden="true">*</span></label>
              <input id="event-location" v-model="props.eventForm.location" name="location" maxlength="160" required />
            </div>
            <div class="design-event-editor__field">
              <label for="event-address">Endereço <span aria-hidden="true">*</span></label>
              <input id="event-address" v-model="props.eventForm.address" name="address" maxlength="500" required />
            </div>
          </div>

          <div class="design-event-editor__field-row">
            <div class="design-event-editor__field">
              <label for="event-rsvp">Prazo para confirmar presença <span aria-hidden="true">*</span></label>
              <input id="event-rsvp" v-model="props.eventForm.rsvpDeadline" type="text" inputmode="numeric" name="rsvpDeadline" placeholder="2026-11-10T23:59" required />
            </div>
            <div class="design-event-editor__field">
              <label for="event-time-zone">Fuso horário <span aria-hidden="true">*</span></label>
              <select id="event-time-zone" v-model="props.eventForm.timeZone" name="timeZone" required>
                <option v-for="zone in EVENT_TIME_ZONES" :key="zone.value" :value="zone.value">{{ zone.label }}</option>
              </select>
            </div>
          </div>

          <div class="design-event-editor__field-row design-event-editor__field-row--policy">
            <div class="design-event-editor__field">
              <label for="event-companion-limit">Limite de acompanhantes</label>
              <input id="event-companion-limit" v-model.number="props.eventForm.companionLimit" type="number" name="companionLimit" min="0" max="20" step="1" required />
            </div>
            <label class="design-event-editor__check" for="event-companion-names">
              <input id="event-companion-names" v-model="props.eventForm.companionNamesRequired" type="checkbox" name="companionNamesRequired" />
              <span>Exigir nome dos acompanhantes</span>
            </label>
          </div>
          <p class="design-event-editor__date-help">Digite a hora local no fuso selecionado ou ISO com offset. Horários ambíguos ou inexistentes são recusados.</p>
        </section>

        <p class="design-event-editor__draft-note"><span aria-hidden="true">i</span> As alterações serão aplicadas ao evento ao salvar.</p>
      </form>

      <aside v-if="props.summary" class="design-event-editor__side">
        <section class="design-event-editor__card design-event-editor__summary" aria-labelledby="design-event-summary-title">
          <div class="design-event-editor__section-title">
            <h2 id="design-event-summary-title">Resumo</h2>
          </div>
          <p><strong>{{ props.summary.invited }}</strong><span>convidados</span></p>
          <p><strong>{{ props.summary.confirmed }}</strong><span>confirmados</span></p>
          <p><strong>{{ props.summary.confirmationRate }}%</strong><span>taxa de confirmação</span></p>
        </section>
      </aside>
    </div>
  </section>
</template>
