<script setup lang="ts">
import { EVENT_TIME_ZONES } from '~/modules/private/events/date-time'

type EventItem = {
  id: string
  name: string
  location: string
  address: string
  startsAt: string
  rsvpDeadline: string
  timeZone: string
  status: string
  publishedTemplateVersion?: number
}

const props = defineProps<{ event: EventItem }>()
const emit = defineEmits<{
  edit: []
  template: []
  invitations: []
  delivery: []
  automations: []
  revise: []
  cancel: []
}>()
const editable = computed(() => props.event.status === 'draft')
const published = computed(() => Boolean(props.event.publishedTemplateVersion && props.event.status !== 'cancelled'))
const timeZoneLabel = computed(() => EVENT_TIME_ZONES.find(zone => zone.value === props.event.timeZone)?.label
  ?? props.event.timeZone.split('/').at(-1)?.replaceAll('_', ' ') ?? props.event.timeZone)
</script>

<template>
  <article class="record-card design-event-card">
    <div class="record-topline">
      <span class="status-chip">{{ event.status === 'cancelled' ? 'Cancelado' : event.publishedTemplateVersion ? `Publicado · v${event.publishedTemplateVersion}` : 'Rascunho' }}</span>
    </div>
    <h3>{{ event.name }}</h3>
    <p>{{ event.location }} · {{ event.address }}</p>
    <dl class="event-details">
      <div><dt>Início</dt><dd>{{ new Date(event.startsAt).toLocaleString('pt-BR', { timeZone: event.timeZone }) }}</dd></div>
      <div><dt>Prazo de confirmação</dt><dd>{{ new Date(event.rsvpDeadline).toLocaleString('pt-BR', { timeZone: event.timeZone }) }}</dd></div>
      <div><dt>Fuso</dt><dd>{{ timeZoneLabel }}</dd></div>
    </dl>
    <div class="design-event-card__actions" role="group" :aria-label="`Ações de ${event.name}`">
      <button v-if="editable" class="design-event-card__action" type="button" aria-label="Editar" title="Editar evento" @click="emit('edit')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14 7 3 3"/></svg>
      </button>
      <button class="design-event-card__action" type="button" aria-label="Editar convite" title="Editar convite" @click="emit('template')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M15 3v5h4M8 12h7M8 16h7"/></svg>
      </button>
      <button class="design-event-card__action" type="button" aria-label="Gerenciar convites" title="Gerenciar convites" :disabled="!published" @click="emit('invitations')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></svg>
      </button>
      <button class="design-event-card__action" type="button" aria-label="Prévia e envios" title="Prévia e envios" :disabled="!published" @click="emit('delivery')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 18-8-7 18-3.5-7.5L3 11Z"/><path d="M10.5 13.5 21 3"/></svg>
      </button>
      <button class="design-event-card__action" type="button" aria-label="Automações" title="Automações" @click="emit('automations')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2ZM19 17l.7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/></svg>
      </button>
      <button v-if="published" class="design-event-card__action" type="button" aria-label="Revisar evento e avisar" title="Revisar evento e avisar" @click="emit('revise')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.3-5.7M20 3v6h-6"/><path d="M12 7v5l3 2"/></svg>
      </button>
      <button v-if="published" class="design-event-card__action design-event-card__action--danger" type="button" aria-label="Cancelar evento" title="Cancelar evento · exige confirmação" @click="emit('cancel')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M6 6 18 18"/></svg>
      </button>
    </div>
    <details class="design-event-card__legend">
      <summary>Ver nomes das ações</summary>
      <ul>
        <li v-if="editable">Editar evento</li>
        <li>Editar convite</li>
        <li>Gerenciar convites</li>
        <li>Prévia e envios</li>
        <li>Automações</li>
        <li v-if="published">Revisar evento e avisar</li>
        <li v-if="published">Cancelar evento exige confirmação</li>
      </ul>
    </details>
    <slot />
  </article>
</template>
