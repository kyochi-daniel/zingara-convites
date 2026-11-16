export type Guest = {
  id: string
  name: string
  phone: string
  email?: string
  tags: string[]
  notes: string
  whatsappConsent?: boolean
  authorizationSource?: string
}

export type CsvRow = {
  line: number
  guest?: Omit<Guest, 'id'>
  errors: string[]
  duplicates: string[]
}

type State<T> = { value: T }
type GuestDependencies = {
  selectedOrganizationId: State<string>
  csrfToken: State<string>
  dashboardGuestTotal: State<number>
  error: State<string>
  notice: State<string>
  saving: State<boolean>
}

export function useGuests(dependencies: GuestDependencies) {
  const {
    selectedOrganizationId,
    csrfToken,
    dashboardGuestTotal,
    error,
    notice,
    saving,
  } = dependencies

  const guests = ref<Guest[]>([])
  const guestTotal = ref(0)
  const guestPage = ref(1)
  const guestPageSize = ref(100)
  const guestLoading = ref(false)
  const guestQuery = ref('')
  const guestSearch = ref('')
  const guestTag = ref('')
  const editingGuestId = ref<string | null>(null)
  const guestForm = reactive({ name: '', phone: '', email: '', tags: '', notes: '', whatsappConsent: false, authorizationSource: '' })
  const csvName = ref('')
  const csvText = ref('')
  const csvBatchId = ref('')
  const csvRows = ref<CsvRow[]>([])
  const acceptedRows = ref<number[]>([])
  const importing = ref(false)
  const importWhatsappConsent = ref(false)
  const importAuthorizationSource = ref('')
  const contactFile = ref<{ name: string; contentBase64: string } | null>(null)
  let previewVersion = 0
  let loadVersion = 0

  const validCsvRows = computed(() => csvRows.value.filter(row => !row.errors.length))
  const guestTitle = computed(() => editingGuestId.value ? 'Editar contato' : 'Novo contato')

  function guestPath(suffix = '') {
    const base = `/api/admin/organizations/${encodeURIComponent(selectedOrganizationId.value)}/guests`
    return suffix ? `${base}/${encodeURIComponent(suffix)}` : base
  }

  function resetGuestForm() {
    editingGuestId.value = null
    Object.assign(guestForm, { name: '', phone: '', email: '', tags: '', notes: '', whatsappConsent: false, authorizationSource: '' })
  }

  async function loadGuests() {
    if (!selectedOrganizationId.value) return
    const version = ++loadVersion
    const organizationId = selectedOrganizationId.value
    const page = guestPage.value
    const limit = guestPageSize.value
    const q = guestSearch.value
    const tag = guestTag.value
    guestLoading.value = true
    guests.value = []
    try {
      const result = await $fetch<{ items: Guest[]; total: number }>(guestPath(), {
        query: {
          page,
          limit,
          ...(q ? { q } : {}),
          ...(tag ? { tag } : {}),
        },
      })
      if (version !== loadVersion || organizationId !== selectedOrganizationId.value) return
      guests.value = result.items
      guestTotal.value = result.total
      if (!q && !tag) dashboardGuestTotal.value = result.total
    } catch {
      if (version !== loadVersion || organizationId !== selectedOrganizationId.value) return
      guests.value = []
      guestTotal.value = 0
      error.value = 'Não foi possível carregar os contatos.'
    } finally {
      if (version === loadVersion) guestLoading.value = false
    }
  }

  function searchDesignGuests(value: { query: string; tag: string }) {
    guestQuery.value = value.query
    guestSearch.value = value.query
    guestTag.value = value.tag
    guestPage.value = 1
    void loadGuests()
  }

  function editGuest(guest: Guest) {
    editingGuestId.value = guest.id
    Object.assign(guestForm, {
      name: guest.name,
      phone: guest.phone,
      email: guest.email ?? '',
      tags: guest.tags.join(', '),
      notes: guest.notes,
      whatsappConsent: guest.whatsappConsent ?? false,
      authorizationSource: guest.authorizationSource ?? '',
    })
    error.value = ''
  }

  function guestPayload() {
    return {
      name: guestForm.name,
      phone: guestForm.phone,
      ...(guestForm.email ? { email: guestForm.email } : {}),
      tags: guestForm.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      notes: guestForm.notes,
      whatsappConsent: guestForm.whatsappConsent,
      ...(guestForm.whatsappConsent ? { authorizationSource: guestForm.authorizationSource.trim() } : {}),
    }
  }

  async function saveGuest() {
    const creating = !editingGuestId.value
    saving.value = true
    error.value = ''
    notice.value = ''
    try {
      await $fetch(editingGuestId.value ? guestPath(editingGuestId.value) : guestPath(), {
        method: editingGuestId.value ? 'PATCH' : 'POST',
        headers: { 'x-csrf-token': csrfToken.value },
        body: guestPayload(),
      })
      notice.value = editingGuestId.value ? 'Contato atualizado.' : 'Contato criado.'
      if (creating) dashboardGuestTotal.value++
      resetGuestForm()
      guestPage.value = 1
      await loadGuests()
    } catch {
      error.value = 'Não foi possível salvar. Confira o telefone internacional e os campos.'
    } finally {
      saving.value = false
    }
  }

  async function changeGuestPage(page: number) {
    guestPage.value = page
    await loadGuests()
  }

  async function changeGuestPageSize(size: number) {
    guestPageSize.value = [20, 50, 100].includes(size) ? size : 100
    guestPage.value = 1
    await loadGuests()
  }

  function clearCsv() {
    previewVersion++
    csvName.value = ''
    csvText.value = ''
    csvBatchId.value = ''
    csvRows.value = []
    acceptedRows.value = []
    contactFile.value = null
    importWhatsappConsent.value = false
    importAuthorizationSource.value = ''
  }

  function setAccepted(line: number, checked: boolean) {
    const before = [...acceptedRows.value].sort((a, b) => a - b).join(',')
    acceptedRows.value = checked
      ? [...new Set([...acceptedRows.value, line])].sort((a, b) => a - b)
      : acceptedRows.value.filter(row => row !== line)
    if (before !== acceptedRows.value.join(',')) csvBatchId.value = crypto.randomUUID()
  }

  function setImportAuthorization(consent: boolean, source: string) {
    if (importWhatsappConsent.value !== consent || importAuthorizationSource.value !== source.trim()) csvBatchId.value = crypto.randomUUID()
    importWhatsappConsent.value = consent
    importAuthorizationSource.value = source.trim()
  }

  async function chooseContactFile(event: Event) {
    clearCsv()
    error.value = ''
    notice.value = ''
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const version = previewVersion
    const organizationId = selectedOrganizationId.value
    csvName.value = file.name
    try {
      if (!/\.(csv|txt|docx|doc)$/i.test(file.name)) throw new Error('format')
      if (file.size > 262_144) throw new Error('size')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const payload = { name: file.name, contentBase64: btoa(binary) }
      if (version !== previewVersion || organizationId !== selectedOrganizationId.value) return
      const preview = await $fetch<{ rows: CsvRow[] }>(guestPath('preview'), {
        method: 'POST', headers: { 'x-csrf-token': csrfToken.value }, body: { file: payload },
      })
      if (version !== previewVersion || organizationId !== selectedOrganizationId.value) return
      contactFile.value = payload
      csvRows.value = preview.rows
      csvBatchId.value = crypto.randomUUID()
      notice.value = `${preview.rows.length} linhas analisadas. Escolha quais contatos importar.`
    } catch (problem) {
      if (version !== previewVersion || organizationId !== selectedOrganizationId.value) return
      error.value = problem instanceof Error && problem.message === 'size' ? 'O arquivo ultrapassa o limite de 256 KiB.' :
        problem instanceof Error && problem.message === 'format' ? 'Formato não suportado. Use CSV, TXT, DOCX ou DOC.' :
        'Não foi possível analisar o arquivo. Use até 200 contatos; confira formato e cabeçalho. DOC protegido deve ser convertido para CSV ou TXT.'
    }
  }

  async function chooseCsv(event: Event) {
    clearCsv()
    error.value = ''
    notice.value = ''
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    csvName.value = file.name
    csvBatchId.value = crypto.randomUUID()
    try {
      const csv = await file.text()
      if (new TextEncoder().encode(JSON.stringify({ csv })).length > 16_384) throw new Error('size')
      csvText.value = csv
      const preview = await $fetch<{ rows: CsvRow[] }>(guestPath('preview'), {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken.value },
        body: { csv },
      })
      csvRows.value = preview.rows
      notice.value = `${preview.rows.length} linhas analisadas. Escolha quais contatos importar.`
    } catch (problem: unknown) {
      error.value = problem instanceof Error && problem.message === 'size'
        ? 'O arquivo ultrapassa o limite de 16 KiB.'
        : 'Não foi possível analisar o CSV. Confira cabeçalho, tamanho e aspas.'
    }
  }

  async function importCsv() {
    if (!csvBatchId.value || !acceptedRows.value.length) return
    if (contactFile.value && importWhatsappConsent.value && importAuthorizationSource.value.trim().length < 5) {
      error.value = 'Informe a fonte verificável da autorização WhatsApp dos contatos selecionados.'
      return
    }
    importing.value = true
    error.value = ''
    notice.value = ''
    try {
      const result = await $fetch<{ created: Guest[]; reused?: Guest[] }>(guestPath('import'), {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken.value },
        body: {
          ...(contactFile.value ? { file: contactFile.value, whatsappConsent: importWhatsappConsent.value,
            ...(importWhatsappConsent.value ? { authorizationSource: importAuthorizationSource.value.trim() } : {}),
          } : { csv: csvText.value }),
          acceptedRows: [...acceptedRows.value].sort((a, b) => a - b),
          batchId: csvBatchId.value,
        },
      })
      notice.value = result.reused ? `${result.created.length} contatos confirmados; ${result.reused.length} contatos existentes reutilizados.` :
        `${result.created.length} contatos confirmados na importação.`
      dashboardGuestTotal.value += result.created.length
      guestPage.value = 1
      await loadGuests()
    } catch {
      error.value = 'A importação não terminou. Repetir sem alterar arquivo ou seleção tentará concluir o mesmo lote.'
    } finally {
      importing.value = false
    }
  }

  return {
    guests,
    guestTotal,
    guestPage,
    guestPageSize,
    guestLoading,
    guestQuery,
    guestSearch,
    guestTag,
    editingGuestId,
    guestForm,
    csvName,
    csvText,
    csvBatchId,
    csvRows,
    acceptedRows,
    importing,
    importWhatsappConsent,
    importAuthorizationSource,
    setImportAuthorization,
    chooseContactFile,
    validCsvRows,
    guestTitle,
    loadGuests,
    searchDesignGuests,
    editGuest,
    resetGuestForm,
    saveGuest,
    changeGuestPage,
    changeGuestPageSize,
    clearCsv,
    setAccepted,
    chooseCsv,
    importCsv,
  }
}
