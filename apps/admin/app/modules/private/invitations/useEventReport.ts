import type { EventReport } from '@zingara/contracts'

type RefLike<T> = { value: T }

export function useEventReport(dependencies: {
  organizationId: RefLike<string>
  eventId: RefLike<string>
}) {
  const eventReport = ref<EventReport | null>(null)
  const eventReportLoading = ref(false)
  const eventReportError = ref('')
  const eventReportNotice = ref('')
  const copyFallback = ref('')
  let requestSerial = 0
  let loadedScope = ''

  const confirmed = computed(() => eventReport.value?.confirmed ?? [])
  const hasConfirmed = computed(() => confirmed.value.length > 0)
  const scopeKey = (organizationId: string, eventId: string) => `${organizationId}\u0000${eventId}`

  function resetReport() {
    requestSerial += 1
    loadedScope = ''
    eventReport.value = null
    eventReportLoading.value = false
    eventReportError.value = ''
    eventReportNotice.value = ''
    copyFallback.value = ''
  }

  async function loadReport() {
    const organizationId = dependencies.organizationId.value
    const eventId = dependencies.eventId.value
    const requestedScope = scopeKey(organizationId, eventId)
    const requestId = ++requestSerial

    eventReportError.value = ''
    eventReportNotice.value = ''
    copyFallback.value = ''
    if (loadedScope !== requestedScope) eventReport.value = null
    if (!organizationId || !eventId) {
      eventReportLoading.value = false
      return
    }

    eventReportLoading.value = true
    const current = () => requestId === requestSerial
      && organizationId === dependencies.organizationId.value
      && eventId === dependencies.eventId.value

    try {
      const result = await $fetch<{ report: EventReport }>(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/events/${encodeURIComponent(eventId)}/report`,
      )
      if (!current()) return
      eventReport.value = result.report
      loadedScope = requestedScope
    } catch {
      if (!current()) return
      eventReportError.value = eventReport.value && loadedScope === requestedScope
        ? 'Não foi possível atualizar o acompanhamento. Os dados exibidos podem estar desatualizados.'
        : 'Não foi possível carregar o acompanhamento deste evento.'
    } finally {
      if (current()) eventReportLoading.value = false
    }
  }

  function confirmedCopyText() {
    if (!eventReport.value || !confirmed.value.length) return ''
    const lines = confirmed.value.map((item: EventReport['confirmed'][number], index: number) => `${index + 1}. ${item.name} — ${item.phone}`)
    return [
      `Confirmados — ${eventReport.value.eventName}`,
      `Total: ${confirmed.value.length} convites confirmados · ${eventReport.value.rsvp.peopleConfirmed} pessoas`,
      '',
      ...lines,
    ].join('\n')
  }

  async function copyConfirmed() {
    const text = confirmedCopyText()
    if (!text) return
    const copyRequest = requestSerial
    const organizationId = dependencies.organizationId.value
    const eventId = dependencies.eventId.value
    const copiedScope = scopeKey(organizationId, eventId)
    const current = () => copyRequest === requestSerial
      && organizationId === dependencies.organizationId.value
      && eventId === dependencies.eventId.value
      && copiedScope === loadedScope
    eventReportError.value = ''
    eventReportNotice.value = ''
    copyFallback.value = ''
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(text)
      if (!current()) return
      eventReportNotice.value = 'Lista completa de confirmados copiada.'
    } catch {
      if (!current()) return
      copyFallback.value = text
      eventReportError.value = 'O navegador não permitiu copiar. Selecione o texto abaixo e copie manualmente.'
    }
  }

  return {
    eventReport,
    eventReportLoading,
    eventReportError,
    eventReportNotice,
    copyFallback,
    confirmed,
    hasConfirmed,
    resetReport,
    loadReport,
    confirmedCopyText,
    copyConfirmed,
  }
}
