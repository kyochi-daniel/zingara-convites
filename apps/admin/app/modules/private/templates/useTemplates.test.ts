import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTemplates } from './useTemplates'
import { defaultTemplate, defaultEventMessageTemplate } from '@zingara/contracts'

function ref<T>(value: T) { return { value } }
function reactive<T extends object>(value: T) { return value }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }

afterEach(() => vi.unstubAllGlobals())

describe('template data', () => {
  it('mostra prévia separada e restaura o padrão ao carregar versão antiga sem mensagem', async () => {
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('computed', computed)
    const event = { id: 'event-1', name: 'Festa', startsAt: '2027-01-15T22:00:00.000Z', rsvpDeadline: '2027-01-13T00:00:00.000Z', timeZone: 'America/Campo_Grande', location: 'Local', companionLimit: 2, publishedTemplateVersion: 1 }
    const { message: _message, ...legacy } = defaultTemplate
    const request = vi.fn().mockResolvedValueOnce({ template: { ...defaultTemplate, message: 'Rascunho: {{convidado.nome}} {{evento.fuso}} {{convite.link}}' } })
      .mockResolvedValueOnce({ publication: { version: 1, template: legacy,
        event: { ...event, name: 'Festa publicada', startsAt: '2027-01-16T22:00:00.000Z' } } })
    vi.stubGlobal('$fetch', request)
    const state = useTemplates({ selectedOrganizationId: ref('org'), csrfToken: ref('csrf'), events: ref<any[]>([event]), activeArea: ref('events') })
    await state.openTemplateEditor(event as any)
    expect(state.messagePreview.value).toBe('Rascunho: Ana Convidada Horário de Ponta Porã https://convite.exemplo/ana')
    expect(state.templateForm.body).toBe(defaultTemplate.body)
    await state.viewPublishedVersion(1)
    expect(state.templateForm.message).toBe(defaultEventMessageTemplate)
    expect(state.messagePreview.value).not.toContain('Rascunho:')
    expect(state.previewValues.value['evento.nome']).toBe('Festa publicada')
    expect(state.previewValues.value['evento.data']).toBe('16 de janeiro de 2027')
    state.editCurrentDraft()
    expect(state.messagePreview.value).toContain('Rascunho:')
    state.resetTemplates()
    expect(state.templateForm.message).toBe(defaultEventMessageTemplate)
  })
  it('opens the event draft without changing a published snapshot', async () => {
    const template = { layout: 'editorial', title: '{{evento.nome}}', subtitle: 'Olá', body: 'Mensagem', primaryButtonText: 'Confirmar', secondaryButtonText: 'Recusar', colors: { background: '#ffffff', text: '#111111', accent: '#333333' }, font: 'serif', alignment: 'left', blocks: { date: true, location: true, rsvp: true } }
    const request = vi.fn().mockResolvedValue({ template })
    vi.stubGlobal('$fetch', request)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('computed', computed)
    const activeArea = ref('events')
    const events = ref<any[]>([{ id: 'event-1', name: 'Evento', startsAt: '2027-01-15T22:00:00.000Z', rsvpDeadline: '2027-01-13T00:00:00.000Z', timeZone: 'America/Campo_Grande', location: 'Local', companionLimit: 2, publishedTemplateVersion: 3 }])
    const state = useTemplates({ selectedOrganizationId: ref('org/id'), csrfToken: ref('csrf'), events, activeArea })

    await state.openTemplateEditor(events.value[0])

    expect(activeArea.value).toBe('template')
    expect(state.publishedVersion.value).toBe(3)
    expect(request).toHaveBeenCalledWith('/api/admin/organizations/org%2Fid/events/event-1/template')
  })
})
