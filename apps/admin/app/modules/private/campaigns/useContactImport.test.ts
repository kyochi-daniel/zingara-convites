import { afterEach, describe, expect, it, vi } from 'vitest'
import { useContactImport } from './useContactImport'

function ref<T>(value: T) { return { value } }
const rows = [
  { line: 2, guest: { name: 'Contato de teste', phone: '+5567999990001' }, errors: [], duplicates: [] },
  { line: 3, errors: ['Telefone ausente'], duplicates: [] },
]
function setup() {
  const request = vi.fn()
  vi.stubGlobal('$fetch', request)
  vi.stubGlobal('ref', ref)
  const organizationId = ref('organization/id')
  return { request, organizationId, ...useContactImport({ organizationId, csrfToken: ref('csrf') }) }
}
afterEach(() => vi.unstubAllGlobals())

describe('importação revisada da campanha', () => {
  it('gera prévia sem persistir e aceita apenas linhas válidas selecionadas explicitamente', async () => {
    const state = setup()
    state.request.mockResolvedValue({ rows })
    await state.chooseFile(new File(['Contato de teste; +5567999990001'], 'contatos.txt'))
    expect(state.request).toHaveBeenCalledWith('/api/admin/organizations/organization%2Fid/guests/preview', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf' },
      body: { file: { name: 'contatos.txt', contentBase64: expect.any(String) } },
    })
    expect(state.selectedRows.value).toEqual([])
    state.selectRow(3, true)
    expect(state.selectedRows.value).toEqual([])
    state.selectRow(2, true)
    expect(state.selectedRows.value).toEqual([2])
    expect(state.whatsappConsent.value).toBe(false)
  })

  it('rejeita extensão e tamanho antes de ler ou transmitir o arquivo', async () => {
    const state = setup()
    await state.chooseFile(new File(['dados'], 'contatos.pdf'))
    expect(state.error.value).toContain('CSV, TXT, DOC ou DOCX')
    await state.chooseFile(new File(['x'.repeat(262145)], 'contatos.docx'))
    expect(state.error.value).toContain('256 KiB')
    expect(state.request).not.toHaveBeenCalled()
  })

  it('mantém o mesmo lote ao repetir falha e não infere consentimento pela seleção', async () => {
    const state = setup()
    state.request.mockResolvedValueOnce({ rows })
    await state.chooseFile(new File(['dados'], 'contatos.csv'))
    state.selectRow(2, true)
    state.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ created: [{ id: 'guest-1' }] })
    await state.importSelected()
    const firstBody = state.request.mock.calls[1]![1].body
    await state.importSelected()
    expect(state.request.mock.calls[2]![1].body).toEqual(firstBody)
    expect(firstBody).toMatchObject({ acceptedRows: [2], whatsappConsent: false, batchId: expect.any(String) })
    expect(state.notice.value).toContain('1 contato')
    expect(state.rows.value).toEqual([])
  })

  it('descarta resposta de prévia de outra organização ou de um arquivo substituído', async () => {
    const state = setup()
    let release!: (value: unknown) => void
    state.request.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const selecting = state.chooseFile(new File(['dados'], 'contatos.txt'))
    await vi.waitFor(() => expect(state.request).toHaveBeenCalled())
    state.organizationId.value = 'other'
    state.resetImport()
    release({ rows })
    await selecting
    expect(state.rows.value).toEqual([])
    expect(state.busy.value).toBe(false)
  })

  it('exige a fonte verificável do consentimento e trata contatos reutilizados sem alterar sua autorização', async () => {
    const state = setup()
    state.request.mockResolvedValueOnce({ rows })
    await state.chooseFile(new File(['dados'], 'contatos.txt'))
    state.selectRow(2, true)
    state.setConsent(true)
    await state.importSelected()
    expect(state.request).toHaveBeenCalledTimes(1)
    expect(state.error.value).toContain('fonte')
    state.setAuthorizationSource(' Formulário de teste, registro 42 ')
    state.request.mockResolvedValueOnce({ created: [], reused: [{ id: 'existing' }] })
    await expect(state.importSelected()).resolves.toBe(1)
    expect(state.request).toHaveBeenLastCalledWith(expect.stringContaining('/guests/import'), expect.objectContaining({
      body: expect.objectContaining({ whatsappConsent: true, authorizationSource: 'Formulário de teste, registro 42' }),
    }))
    expect(state.notice.value).toContain('1 contato existente')
    expect(state.notice.value).toContain('não foi alterado')
  })
})
