import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEventReport } from './useEventReport'

function ref<T>(value: T) { return { value } }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const report = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1',
  eventName: 'Celebração da Ana',
  generatedAt: '2026-10-19T12:00:00.000Z',
  messages: { total: 7, accepted: 6, delivered: 5, read: 3, awaitingDelivery: 1, failed: 1 },
  rsvp: { pending: 1, accepted: 2, declined: 1, revoked: 0, peopleConfirmed: 3 },
  confirmed: [
    { invitationId: 'inv-1', guestId: 'guest-1', name: 'Ana + Família', phone: '+5567999990001', peopleCount: 2 },
    { invitationId: 'inv-2', guestId: 'guest-2', name: 'José da Silva', phone: '+595981234567', peopleCount: 1 },
  ],
  ...overrides,
})

function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  const organizationId = ref('org/id')
  const eventId = ref('event/id')
  return { request, organizationId, eventId, ...useEventReport({ organizationId, eventId }) }
}

afterEach(() => vi.unstubAllGlobals())

describe('event report', () => {
  it('requests the report for the explicit organization and event scope', async () => {
    const state = setup()
    state.request.mockResolvedValue({ report: report() })

    await state.loadReport()

    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/org%2Fid/events/event%2Fid/report')
    expect(state.eventReport.value?.messages.delivered).toBe(5)
    expect(state.confirmed.value).toHaveLength(2)
  })

  it('clears names immediately and ignores a late response after the scope changes', async () => {
    const state = setup()
    const first = deferred<{ report: ReturnType<typeof report> }>()
    const second = deferred<{ report: ReturnType<typeof report> }>()
    state.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const oldLoad = state.loadReport()
    state.organizationId.value = 'org-2'
    state.eventId.value = 'event-2'
    const newLoad = state.loadReport()
    expect(state.eventReport.value).toBeNull()

    first.resolve({ report: report({ eventName: 'Evento antigo' }) })
    await oldLoad
    expect(state.eventReport.value).toBeNull()

    second.resolve({ report: report({ eventId: 'event-2', eventName: 'Evento atual', confirmed: [] }) })
    await newLoad
    expect(state.eventReport.value?.eventName).toBe('Evento atual')
    expect(state.hasConfirmed.value).toBe(false)
  })

  it('copies every confirmed contact with event title, total, names and full phones', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const state = setup()
    const confirmed = Array.from({ length: 125 }, (_, index) => ({
      invitationId: `inv-${index + 1}`,
      guestId: `guest-${index + 1}`,
      name: index === 124 ? 'Última Convidada' : `Convidada ${index + 1}`,
      phone: index === 124 ? '+595981234567' : `+55679999${String(index).padStart(4, '0')}`,
      peopleCount: 1,
    }))
    state.request.mockResolvedValue({ report: report({ confirmed, rsvp: { pending: 0, accepted: 125, declined: 0, revoked: 0, peopleConfirmed: 125 } }) })
    await state.loadReport()

    await state.copyConfirmed()

    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).toContain('Confirmados — Celebração da Ana')
    expect(copied).toContain('Total: 125 convites confirmados · 125 pessoas')
    expect(copied).toContain('1. Convidada 1 — +556799990000')
    expect(copied).toContain('125. Última Convidada — +595981234567')
    expect(copied.match(/^\d+\. /gm)).toHaveLength(125)
    expect(state.copyFallback.value).toBe('')
  })

  it('offers the complete text for manual copy when the clipboard fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } })
    const state = setup()
    state.request.mockResolvedValue({ report: report() })
    await state.loadReport()

    await state.copyConfirmed()

    expect(state.copyFallback.value).toContain('Ana + Família — +5567999990001')
    expect(state.copyFallback.value).toContain('José da Silva — +595981234567')
    expect(state.eventReportError.value).toContain('copie manualmente')
  })

  it('does not expose copy fallback from an old scope after a clipboard rejection', async () => {
    const clipboard = deferred<void>()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockReturnValue(clipboard.promise) } })
    const state = setup()
    state.request.mockResolvedValue({ report: report() })
    await state.loadReport()

    const copying = state.copyConfirmed()
    state.organizationId.value = 'other-org'
    state.eventId.value = 'other-event'
    state.resetReport()
    clipboard.reject(new Error('blocked'))
    await copying

    expect(state.copyFallback.value).toBe('')
    expect(state.eventReportError.value).toBe('')
    expect(state.eventReportNotice.value).toBe('')
  })

  it('shows a safe stale-data error and retains the same scoped report when refresh fails', async () => {
    const state = setup()
    state.request.mockResolvedValueOnce({ report: report() }).mockRejectedValueOnce(new Error('private backend detail'))
    await state.loadReport()
    await state.loadReport()

    expect(state.eventReport.value?.eventName).toBe('Celebração da Ana')
    expect(state.eventReportError.value).toBe('Não foi possível atualizar o acompanhamento. Os dados exibidos podem estar desatualizados.')
    expect(state.eventReportError.value).not.toContain('private backend detail')
    expect(state.eventReportLoading.value).toBe(false)
  })
})
