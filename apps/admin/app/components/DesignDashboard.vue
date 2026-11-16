<template>
  <section class="design-dashboard" aria-labelledby="dashboard-title">
    <header class="dashboard-heading">
      <div>
        <h1 id="dashboard-title">Olá, {{ adminName }}!</h1>
        <p>Acompanhe seus eventos, convidados e confirmações em um só lugar.</p>
      </div>
      <span class="range-chip">{{ rangeLabel }}</span>
    </header>

    <div class="metric-grid" aria-label="Resumo de convidados e convites">
      <article class="metric-card">
        <span class="metric-icon guests"><img src="/design/dashboard/group-11.svg" alt=""></span>
        <span class="metric-copy"><span>Contatos cadastrados</span><strong>{{ guestTotal }}</strong></span>
      </article>
      <article class="metric-card">
        <span class="metric-icon accepted"><img src="/design/dashboard/group-12.svg" alt=""></span>
        <span class="metric-copy"><span>Pessoas confirmadas</span><strong>{{ hasRsvpData ? confirmedPeople : '—' }}</strong></span>
      </article>
      <article class="metric-card">
        <span class="metric-icon pending"><img src="/design/dashboard/group-13.svg" alt=""></span>
        <span class="metric-copy"><span>Convites pendentes</span><strong>{{ hasRsvpData ? invitationTotals.pending : '—' }}</strong></span>
      </article>
      <article class="metric-card">
        <span class="metric-icon declined"><img src="/design/dashboard/group-14.svg" alt=""></span>
        <span class="metric-copy"><span>Convites recusados</span><strong>{{ hasRsvpData ? invitationTotals.declined : '—' }}</strong></span>
      </article>
    </div>

    <div class="dashboard-grid">
      <section class="dashboard-card next-event" aria-labelledby="next-event-title">
        <header class="card-heading">
          <h2 id="next-event-title">Próximo evento</h2>
          <button class="text-action" type="button" @click="emit('navigate', 'events')">Ver todos <img src="/design/dashboard/group-15.svg" alt=""></button>
        </header>
        <article v-if="nextEvent" class="event-content">
          <img v-if="nextEvent.coverImageUrl" class="event-photo" :src="nextEvent.coverImageUrl" alt="">
          <div class="event-details" :style="nextEvent.coverImageUrl ? undefined : { gridColumn: '1 / -1' }">
            <h3>{{ nextEvent.name }}</h3>
            <p class="event-date">{{ formattedEventDate }}</p>
            <p class="event-location"><img src="/design/dashboard/group-16.svg" alt="">{{ nextEvent.location }} · {{ nextEvent.address }}</p>
            <div v-if="nextEventTotals" class="event-totals">
              <span><img src="/design/dashboard/group-17.svg" alt="">{{ nextEventTotals.accepted + nextEventTotals.pending + nextEventTotals.declined }} convidados</span>
              <span class="confirmed-pill"><img src="/design/dashboard/group-18.svg" alt="">{{ nextEventTotals.accepted }} confirmados</span>
            </div>
          </div>
        </article>
        <p v-else class="empty-event">Nenhum evento futuro cadastrado.</p>
      </section>

      <section class="dashboard-card quick-actions" aria-labelledby="quick-actions-title">
        <h2 id="quick-actions-title">Ações rápidas</h2>
        <div class="quick-action-list">
          <button class="quick-action" type="button" @click="emit('create', 'invitation')">
            <span class="action-icon invitation"><img src="/design/dashboard/group-19.svg" alt=""></span><span>Novo convite</span>
          </button>
          <button class="quick-action" type="button" @click="emit('action', 'import-guests')">
            <span class="action-icon import"><img src="/design/dashboard/group-20.svg" alt=""></span><span>Importar convidados</span>
          </button>
          <button class="quick-action" type="button" @click="emit('navigate', 'invitations')">
            <span class="action-icon rsvp"><img src="/design/dashboard/group-21.svg" alt=""></span><span>Ver RSVP</span>
          </button>
        </div>
        <aside class="dashboard-tip"><strong>Dica</strong><p>Revise os convites pendentes para manter as confirmações em dia.</p></aside>
      </section>

      <section class="dashboard-card overview-card" aria-labelledby="overview-title">
        <header class="card-heading overview-heading">
          <div><h2 id="overview-title">Visão geral</h2><p>Confirmações nos últimos 30 dias</p></div>
        </header>
        <div class="overview-content">
          <div v-if="hasHistory" class="chart" role="img" aria-label="Série histórica de confirmações">
            <div class="chart-bars">
              <div v-for="(point, index) in chartPoints" :key="`${point.label}-${index}`" class="chart-bar-wrap">
                <span class="chart-bar" :style="{ height: `${Math.max(7, point.value / chartMax * 158)}px`, backgroundColor: barColors[index % barColors.length] }"></span>
                <span v-if="point.label" class="chart-label">{{ point.label }}</span>
              </div>
            </div>
          </div>
          <p v-else class="empty-event">Ainda não há histórico de confirmações.</p>
          <aside class="overview-total">
            <strong>{{ guestTotal }}</strong><span>contatos cadastrados</span>
            <template v-if="hasRsvpData">
              <b>{{ confirmedPercent }}%</b><small>convites confirmados em {{ invitationEvent?.name }}</small>
              <span class="progress-track"><span :style="{ width: `${confirmedPercent}%` }"></span></span>
            </template>
            <template v-else>
              <b>—</b><small>Taxa disponível após publicar um evento.</small>
            </template>
          </aside>
        </div>
      </section>

      <section class="dashboard-card rsvp-summary" aria-labelledby="rsvp-title">
        <h2 id="rsvp-title">Resumo de RSVP</h2>
        <p v-if="hasRsvpData" class="summary-event">{{ invitationEvent?.name }}</p>
        <p v-else class="empty-event">Publique um evento para acompanhar o RSVP.</p>
        <div v-for="row in hasRsvpData ? [
          { label: 'Confirmados', count: eventTotals.accepted, className: 'accepted' },
          { label: 'Pendentes', count: eventTotals.pending, className: 'pending' },
          { label: 'Recusaram', count: eventTotals.declined, className: 'declined' },
        ] : []" :key="row.className" class="rsvp-row">
          <div><span>{{ row.label }}</span><strong :class="row.className">{{ row.count }}</strong></div>
          <span class="rsvp-track"><span :class="row.className" :style="{ width: `${eventDecisions ? row.count / eventDecisions * 100 : 0}%` }"></span></span>
        </div>
        <button v-if="hasRsvpData" class="reminder-link" type="button" @click="emit('navigate', 'invitations')">Ver convites pendentes <img src="/design/dashboard/group-22.svg" alt=""></button>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
type InvitationTotals = {
  pending: number
  accepted: number
  declined: number
  revoked?: number
  peopleConfirmed?: number
}

type DashboardEvent = {
  id: string
  name: string
  location: string
  address: string
  startsAt: string
  timeZone: string
  status: string
  coverImageUrl?: string
}

type HistoryPoint = { label: string; value: number }
type Area = 'events' | 'guests' | 'invitations'

const props = withDefaults(defineProps<{
  adminName?: string
  events: DashboardEvent[]
  guestTotal: number
  invitationTotals: InvitationTotals
  invitationEventId?: string
  history?: HistoryPoint[]
  rangeLabel?: string
}>(), {
  adminName: 'Admin',
  history: undefined,
  rangeLabel: 'Últimos 30 dias',
})

const emit = defineEmits<{
  navigate: [area: Area]
  create: [kind: 'event' | 'invitation']
  action: [name: 'import-guests']
}>()

const barColors = ['#efa9c6', '#f0a9b6', '#e8b09e', '#f3c49e', '#dfae9a', '#f7e5aa', '#f2f1a8', '#e8f2b0', '#c8eaae', '#b8e7af', '#c8d4ff', '#c8d4ff', '#d5c8ff', '#d9bdf1', '#e1c0ee', '#e4c3ec']

const visibleEvents = computed(() => props.events.filter(event => event.status !== 'cancelled'))
const nextEvent = computed(() => visibleEvents.value
  .filter(event => Number.isFinite(Date.parse(event.startsAt)) && Date.parse(event.startsAt) >= Date.now())
  .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0])
const eventTotals = computed(() => props.invitationTotals)
const invitationEvent = computed(() => props.events.find(event => event.id === props.invitationEventId) ?? nextEvent.value)
const hasRsvpData = computed(() => Boolean(props.invitationEventId && invitationEvent.value?.id === props.invitationEventId))
const nextEventTotals = computed(() => props.invitationEventId === nextEvent.value?.id ? eventTotals.value : null)
const eventDecisions = computed(() => eventTotals.value.pending + eventTotals.value.accepted + eventTotals.value.declined)
const confirmedPeople = computed(() => eventTotals.value.peopleConfirmed ?? eventTotals.value.accepted)
const confirmedPercent = computed(() => hasRsvpData.value && eventDecisions.value
  ? Math.round(eventTotals.value.accepted / eventDecisions.value * 100)
  : 0)
const chartPoints = computed(() => props.history ?? [])
const hasHistory = computed(() => chartPoints.value.length > 0)
const chartMax = computed(() => Math.max(1, ...chartPoints.value.map(point => point.value)))
const formattedEventDate = computed(() => {
  if (!nextEvent.value) return ''
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: nextEvent.value.timeZone,
  }).format(new Date(nextEvent.value.startsAt))
})
</script>

<style lang="sass" scoped src="~/assets/_design-dashboard.sass"></style>
