import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutomations } from './useAutomations'

function ref<T>(value: T) { return { value } }
function reactive<T extends object>(value: T) { return value }
function computed<T>(getter: () => T) { return { get value() { return getter() } } }

afterEach(() => vi.unstubAllGlobals())

describe('automation data', () => {
  it('rejects a fixed schedule without explicit offset before calling the API', async () => {
    const request = vi.fn()
    vi.stubGlobal('$fetch', request)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('reactive', reactive)
    vi.stubGlobal('computed', computed)
    const state = useAutomations({ selectedOrganizationId: ref('org-1'), csrfToken: ref('csrf'), activeArea: ref('automations') })
    state.automationEvent.value = { id: 'event-1' } as any
    state.automationForm.anchor = 'fixed'
    state.automationForm.at = '2027-01-15T18:00'
    state.automationForm.text = 'Lembrete'

    await state.saveAutomationRule()

    expect(request).not.toHaveBeenCalled()
    expect(state.automationError.value).toContain('offset explícito')
  })
})
