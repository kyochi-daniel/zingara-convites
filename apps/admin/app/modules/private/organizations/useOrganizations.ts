export type Organization = {
  id?: string
  _id?: string
  name: string
  visualIdentity?: { primaryColor?: string; logoUrl?: string }
  settings?: { replyToEmail?: string }
}

type RefLike<T> = { value: T }

export function organizationId(organization: Organization) {
  return organization.id ?? organization._id ?? ''
}

export function useOrganizations(dependencies: {
  csrfToken: RefLike<string>
  error: RefLike<string>
  notice: RefLike<string>
  saving: RefLike<boolean>
}) {
  const organizations = ref<Organization[]>([])
  const selectedOrganizationId = ref('')
  const editingOrganizationId = ref<string | null>(null)
  const organizationForm = reactive({ name: '', primaryColor: '', logoUrl: '', replyToEmail: '' })

  const selectedOrganization = computed(() => organizations.value.find(organization => organizationId(organization) === selectedOrganizationId.value))
  const organizationOptions = computed(() => organizations.value.map(organization => ({ id: organizationId(organization), name: organization.name })))
  const formTitle = computed(() => editingOrganizationId.value ? 'Editar organização' : 'Nova organização')

  function resetOrganizationForm() {
    editingOrganizationId.value = null
    Object.assign(organizationForm, { name: '', primaryColor: '', logoUrl: '', replyToEmail: '' })
  }

  async function loadOrganizations() {
    try {
      const response = await $fetch<{ items: Organization[] }>('/api/admin/organizations')
      organizations.value = response.items
      if (!response.items.some(organization => organizationId(organization) === selectedOrganizationId.value)) {
        selectedOrganizationId.value = response.items[0] ? organizationId(response.items[0]) : ''
      }
    } catch {
      dependencies.error.value = 'Não foi possível carregar as organizações.'
    }
  }

  function editOrganization(organization: Organization) {
    editingOrganizationId.value = organizationId(organization)
    Object.assign(organizationForm, {
      name: organization.name,
      primaryColor: organization.visualIdentity?.primaryColor ?? '',
      logoUrl: organization.visualIdentity?.logoUrl ?? '',
      replyToEmail: organization.settings?.replyToEmail ?? '',
    })
    dependencies.notice.value = ''
  }

  async function saveOrganization() {
    dependencies.saving.value = true
    dependencies.error.value = ''
    const visualIdentity = {
      ...(organizationForm.primaryColor ? { primaryColor: organizationForm.primaryColor } : {}),
      ...(organizationForm.logoUrl ? { logoUrl: organizationForm.logoUrl } : {}),
    }
    const settings = organizationForm.replyToEmail ? { replyToEmail: organizationForm.replyToEmail } : {}
    const payload = {
      name: organizationForm.name,
      ...(Object.keys(visualIdentity).length ? { visualIdentity } : {}),
      ...(Object.keys(settings).length ? { settings } : {}),
    }
    try {
      const savedMessage = editingOrganizationId.value ? 'Organização atualizada.' : 'Organização criada.'
      if (editingOrganizationId.value) {
        await $fetch(`/api/admin/organizations/${encodeURIComponent(editingOrganizationId.value)}`, {
          method: 'PATCH', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: payload,
        })
      } else {
        await $fetch('/api/admin/organizations', {
          method: 'POST', headers: { 'x-csrf-token': dependencies.csrfToken.value }, body: payload,
        })
      }
      resetOrganizationForm()
      await loadOrganizations()
      dependencies.notice.value = savedMessage
    } catch {
      dependencies.error.value = 'Não foi possível salvar a organização. Verifique os campos.'
    } finally {
      dependencies.saving.value = false
    }
  }

  return {
    organizations,
    selectedOrganizationId,
    editingOrganizationId,
    organizationForm,
    selectedOrganization,
    organizationOptions,
    formTitle,
    resetOrganizationForm,
    loadOrganizations,
    editOrganization,
    saveOrganization,
  }
}
