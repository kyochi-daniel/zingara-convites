<template>
  <section class="event-report" aria-labelledby="event-report-title">
    <header class="event-report-heading">
      <div>
        <h4 id="event-report-title">Acompanhamento do evento</h4>
        <p>Dados deste evento. Contatos de teste não entram nos totais.</p>
      </div>
      <div class="form-actions">
        <button class="button quiet" type="button" :disabled="eventReportLoading" @click="loadReport">
          {{ eventReportLoading ? 'Atualizando…' : 'Atualizar relatório' }}
        </button>
        <button class="button primary" type="button" :disabled="eventReportLoading || !hasConfirmed" @click="copyConfirmed">
          Copiar confirmados
        </button>
      </div>
    </header>

    <p v-if="eventReportError" class="form-message error" role="alert">{{ eventReportError }}</p>
    <p v-if="eventReportNotice" class="event-report-notice" role="status">{{ eventReportNotice }}</p>
    <textarea
      v-if="copyFallback"
      class="event-report-copy-fallback"
      :value="copyFallback"
      rows="8"
      readonly
      aria-label="Lista de confirmados para cópia manual"
      @focus="($event.target as HTMLTextAreaElement).select()"
    />

    <div v-if="eventReportLoading && !eventReport" class="empty-inline" role="status">Carregando acompanhamento…</div>
    <template v-else-if="eventReport">
      <dl class="event-report-metrics" aria-label="Indicadores do evento">
        <div class="event-report-metric"><dt>Entregues</dt><dd class="event-report-metric-value">{{ eventReport.messages.delivered }}</dd></div>
        <div class="event-report-metric"><dt>Lidas</dt><dd class="event-report-metric-value">{{ eventReport.messages.read }}</dd></div>
        <div class="event-report-metric"><dt>Presenças confirmadas</dt><dd class="event-report-metric-value">{{ eventReport.rsvp.peopleConfirmed }}</dd></div>
      </dl>
      <p class="form-intro">Entregues inclui lidas. Leituras dependem dos recibos do WhatsApp.</p>
      <dl class="invitation-totals" aria-label="Situação dos convites">
        <div><dt>Pendentes</dt><dd>{{ eventReport.rsvp.pending }}</dd></div>
        <div><dt>Confirmados</dt><dd>{{ eventReport.rsvp.accepted }}</dd></div>
        <div><dt>Recusados</dt><dd>{{ eventReport.rsvp.declined }}</dd></div>
        <div><dt>Revogados</dt><dd>{{ eventReport.rsvp.revoked }}</dd></div>
      </dl>
      <p class="form-intro">{{ eventReport.rsvp.accepted }} convites confirmados · {{ eventReport.rsvp.peopleConfirmed }} pessoas</p>

      <div v-if="hasConfirmed" class="event-report-table-scroll" role="region" aria-label="Confirmados do evento" tabindex="0">
        <table class="event-report-table">
          <caption class="visually-hidden">Todos os convidados confirmados, com nome e telefone</caption>
          <thead><tr><th scope="col">Nome</th><th scope="col">Telefone</th></tr></thead>
          <tbody><tr v-for="item in confirmed" :key="item.invitationId"><td>{{ item.name }}</td><td>{{ item.phone }}</td></tr></tbody>
        </table>
      </div>
      <p v-else class="empty-inline">Nenhum convite confirmado neste evento.</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useEventReport } from './useEventReport'
import './event-report.sass'

const props = defineProps({
  organizationId: {
    type: String,
    required: true,
  },
  eventId: {
    type: String,
    required: true,
  },
})

const organizationId = computed(() => props.organizationId)
const eventId = computed(() => props.eventId)
const {
  eventReport,
  eventReportLoading,
  eventReportError,
  eventReportNotice,
  copyFallback,
  confirmed,
  hasConfirmed,
  resetReport,
  loadReport,
  copyConfirmed,
} = useEventReport({ organizationId, eventId })

watch([organizationId, eventId], ([nextOrganizationId, nextEventId]) => {
  if (!nextOrganizationId || !nextEventId) return resetReport()
  void loadReport()
}, { immediate: true })

onBeforeUnmount(resetReport)
</script>
