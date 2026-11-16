import type { CsvRow } from '../guests/useGuests'

type RefLike<T> = { value: T }
type ImportFile = { name: string; contentBase64: string }

export function useContactImport(dependencies: { organizationId: RefLike<string>; csrfToken: RefLike<string> }) {
  const file = ref<ImportFile | null>(null)
  const rows = ref<CsvRow[]>([])
  const selectedRows = ref<number[]>([])
  const whatsappConsent = ref(false)
  const authorizationSource = ref('')
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  let requestSerial = 0
  let batchId = ''

  function resetImport() {
    requestSerial++
    file.value = null
    rows.value = []
    selectedRows.value = []
    whatsappConsent.value = false
    authorizationSource.value = ''
    busy.value = false
    error.value = ''
    notice.value = ''
    batchId = ''
  }

  function path(organizationId: string, action: 'preview' | 'import') {
    return `/api/admin/organizations/${encodeURIComponent(organizationId)}/guests/${action}`
  }

  function selectRow(line: number, checked: boolean) {
    if (busy.value || !rows.value.some(row => row.line === line && row.guest && !row.errors.length)) return
    const next = checked ? [...new Set([...selectedRows.value, line])].sort((a, b) => a - b) : selectedRows.value.filter(item => item !== line)
    if (next.join(',') !== selectedRows.value.join(',')) batchId = crypto.randomUUID()
    selectedRows.value = next
  }

  function setConsent(confirmed: boolean) {
    if (busy.value) return
    if (confirmed !== whatsappConsent.value) batchId = crypto.randomUUID()
    whatsappConsent.value = confirmed
  }
  function setAuthorizationSource(source: string) {
    if (busy.value) return
    if (source !== authorizationSource.value) batchId = crypto.randomUUID()
    authorizationSource.value = source
  }

  async function chooseFile(chosen: File) {
    resetImport()
    const organizationId = dependencies.organizationId.value
    if (!organizationId) return
    if (!/\.(csv|txt|doc|docx)$/i.test(chosen.name)) {
      error.value = 'Escolha um arquivo CSV, TXT, DOC ou DOCX.'
      return
    }
    if (chosen.size > 256 * 1024) {
      error.value = 'O arquivo ultrapassa o limite de 256 KiB.'
      return
    }
    const requestId = ++requestSerial
    const current = () => requestId === requestSerial && organizationId === dependencies.organizationId.value
    busy.value = true
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer())
      if (!current()) return
      const contentBase64 = btoa(bytes.reduce((text, byte) => text + String.fromCharCode(byte), ''))
      const payload = { name: chosen.name, contentBase64 }
      const result = await $fetch<{ rows: CsvRow[] }>(path(organizationId, 'preview'), {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: { file: payload },
      })
      if (!current()) return
      file.value = payload
      rows.value = result.rows
      batchId = crypto.randomUUID()
      notice.value = `${result.rows.length} linhas analisadas. Selecione os contatos que deseja cadastrar.`
    } catch {
      if (current()) error.value = 'Não foi possível analisar o arquivo. Confira o formato, o conteúdo e o limite de 200 contatos.'
    } finally {
      if (requestId === requestSerial) busy.value = false
    }
  }

  async function importSelected() {
    const organizationId = dependencies.organizationId.value
    if (!organizationId || !file.value || !selectedRows.value.length || busy.value) return 0
    const source = authorizationSource.value.trim()
    if (whatsappConsent.value && (source.length < 5 || source.length > 300)) {
      error.value = 'Informe a fonte verificável da autorização WhatsApp, com 5 a 300 caracteres.'
      return 0
    }
    const requestId = ++requestSerial
    const current = () => requestId === requestSerial && organizationId === dependencies.organizationId.value
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<{ created: Array<{ id: string }>; reused?: Array<{ id: string }> }>(path(organizationId, 'import'), {
        method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value },
        body: { file: file.value, acceptedRows: [...selectedRows.value], batchId, whatsappConsent: whatsappConsent.value,
          ...(whatsappConsent.value ? { authorizationSource: source } : {}) },
      })
      if (!current()) return 0
      const count = result.created.length
      const reused = result.reused?.length ?? 0
      resetImport()
      notice.value = `${count} contato${count === 1 ? '' : 's'} confirmado${count === 1 ? '' : 's'} na importação.`
        + (reused ? ` ${reused} contato${reused === 1 ? '' : 's'} existente${reused === 1 ? '' : 's'} reutilizado${reused === 1 ? '' : 's'}. O consentimento de contatos existentes não foi alterado.` : '')
      return count + reused
    } catch {
      if (current()) error.value = 'A importação não terminou. Tente novamente sem alterar o arquivo ou a seleção para concluir o mesmo lote.'
      return 0
    } finally {
      if (requestId === requestSerial) busy.value = false
    }
  }

  return { file, rows, selectedRows, whatsappConsent, authorizationSource, busy, error, notice, resetImport, selectRow, setConsent, setAuthorizationSource, chooseFile, importSelected }
}
