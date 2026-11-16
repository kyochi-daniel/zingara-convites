import { defaultEventMessageTemplate, defaultTemplate, eventTemplateValues, renderEventMessage, type TemplateInput, type TemplateVariable } from '@zingara/contracts'
import { eventDateLabel, eventDeadlineLabel } from '../events/date-time'
import type { EventItem } from '../events/useEvents'

type RefLike<T> = { value: T }
type TemplateEvent = Pick<EventItem, 'name' | 'location' | 'startsAt' | 'rsvpDeadline' | 'timeZone' | 'companionLimit'>
type Publication = { version: number; template: TemplateInput; event?: TemplateEvent }

export function useTemplates(dependencies: {
  selectedOrganizationId: RefLike<string>
  csrfToken: RefLike<string>
  events: RefLike<EventItem[]>
  activeArea: RefLike<string>
}) {
  const templateForm = reactive<TemplateInput>(structuredClone(defaultTemplate))
  const templateEventId = ref('')
  const templateLoading = ref(false)
  const templateSaving = ref(false)
  const templatePublishing = ref(false)
  const templateError = ref('')
  const templateNotice = ref('')
  const imagePreviewUrl = ref('')
  const previewSize = ref<'desktop' | 'mobile'>('desktop')
  const publishedVersion = ref<number | null>(null)
  const viewingPublication = ref<Publication | null>(null)
  const draftBeforePublication = ref<TemplateInput | null>(null)

  const csrfHeaders = computed(() => ({ 'x-csrf-token': dependencies.csrfToken.value }))
  const templateEvent = computed(() => dependencies.events.value.find(event => event.id === templateEventId.value))
  const previewEvent = computed(() => viewingPublication.value?.event ?? templateEvent.value)
  const displayedTemplate = computed(() => viewingPublication.value?.template ?? templateForm)
  const displayedImageUrl = computed(() => {
    const imageId = displayedTemplate.value.imageAssetId
    return imageId ? (viewingPublication.value || !imagePreviewUrl.value ? `/media/${imageId}` : imagePreviewUrl.value) : ''
  })
  const templateEventDateLabel = computed(() => previewEvent.value
    ? eventDateLabel(previewEvent.value.startsAt, previewEvent.value.timeZone)
    : '15 de novembro de 2026, às 18:00')
  const previewValues = computed<Partial<Record<TemplateVariable, string | number>>>(() => ({
    ...eventTemplateValues(previewEvent.value ?? {
      name: 'Celebração em família', location: 'Jardim das Águas', startsAt: '2026-11-15T18:00:00-04:00',
      rsvpDeadline: '2026-11-10T23:59:00-04:00', timeZone: 'America/Campo_Grande',
    }),
    'convidado.nome': 'Ana Convidada',
    'convite.link': 'https://convite.exemplo/ana',
    'convite.limite_acompanhantes': previewEvent.value?.companionLimit ?? 2,
  }))
  const messagePreview = computed(() => renderEventMessage(displayedTemplate.value, previewValues.value))
  const resolvedPreview = computed(() => ({
    dateLabel: templateEventDateLabel.value,
    deadlineLabel: previewEvent.value
      ? eventDeadlineLabel(previewEvent.value.rsvpDeadline, previewEvent.value.timeZone)
      : '10 de novembro de 2026',
  }))

  function templatePath() {
    return `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/events/${encodeURIComponent(templateEventId.value)}/template`
  }

  function applyTemplate(template: TemplateInput) {
    if (!template.imageAssetId) delete templateForm.imageAssetId
    Object.assign(templateForm, JSON.parse(JSON.stringify(template)) as TemplateInput)
    templateForm.message = template.message ?? defaultEventMessageTemplate
    imagePreviewUrl.value = template.imageAssetId ? `/media/${template.imageAssetId}` : ''
  }

  function resetTemplates() {
    applyTemplate(defaultTemplate)
    templateEventId.value = ''
    templateLoading.value = false
    templateSaving.value = false
    templatePublishing.value = false
    templateError.value = ''
    templateNotice.value = ''
    imagePreviewUrl.value = ''
    previewSize.value = 'desktop'
    publishedVersion.value = null
    viewingPublication.value = null
    draftBeforePublication.value = null
  }

  async function openTemplateEditor(event: EventItem) {
    templateEventId.value = event.id
    viewingPublication.value = null
    draftBeforePublication.value = null
    publishedVersion.value = event.publishedTemplateVersion ?? null
    templateError.value = ''
    templateNotice.value = ''
    dependencies.activeArea.value = 'template'
    templateLoading.value = true
    try {
      const result = await $fetch<{ template: TemplateInput }>(templatePath())
      applyTemplate(result.template)
    } catch {
      templateError.value = 'Não foi possível carregar o rascunho do convite.'
    } finally { templateLoading.value = false }
  }

  function closeTemplateEditor() {
    dependencies.activeArea.value = 'events'
    templateEventId.value = ''
    viewingPublication.value = null
    draftBeforePublication.value = null
    templateError.value = ''
    templateNotice.value = ''
  }

  async function saveTemplateDraft() {
    templateSaving.value = true
    templateError.value = ''
    templateNotice.value = ''
    try {
      const result = await $fetch<{ template: TemplateInput }>(templatePath(), {
        method: 'PUT', headers: csrfHeaders.value, body: templateForm,
      })
      applyTemplate(result.template)
      templateNotice.value = 'Rascunho do convite salvo.'
      return true
    } catch {
      templateError.value = 'Não foi possível salvar. Revise os campos e use apenas as variáveis listadas.'
      return false
    } finally { templateSaving.value = false }
  }

  async function publishTemplate() {
    if (viewingPublication.value || templatePublishing.value) return
    templatePublishing.value = true
    templateError.value = ''
    if (!await saveTemplateDraft()) {
      templatePublishing.value = false
      return
    }
    try {
      const result = await $fetch<{ publication: Publication }>(`${templatePath()}/publish`, {
        method: 'POST', headers: csrfHeaders.value, body: {},
      })
      publishedVersion.value = result.publication.version
      const event = templateEvent.value
      if (event) {
        event.status = 'published'
        event.publishedTemplateVersion = result.publication.version
      }
      templateNotice.value = `Convite publicado na versão ${result.publication.version}. Nenhuma mensagem foi enviada.`
    } catch {
      templateError.value = 'Rascunho salvo, mas não foi possível publicar. Tente publicar novamente.'
    } finally { templatePublishing.value = false }
  }

  async function viewPublishedVersion(version: number) {
    if (!publishedVersion.value || version < 1 || version > publishedVersion.value) return
    templateLoading.value = true
    templateError.value = ''
    try {
      const result = await $fetch<{ publication: Publication }>(`${templatePath()}/versions/${version}`)
      draftBeforePublication.value = JSON.parse(JSON.stringify(templateForm)) as TemplateInput
      applyTemplate(result.publication.template)
      viewingPublication.value = result.publication
    } catch { templateError.value = 'Não foi possível carregar a versão publicada.' }
    finally { templateLoading.value = false }
  }

  function editCurrentDraft() {
    if (draftBeforePublication.value) applyTemplate(draftBeforePublication.value)
    draftBeforePublication.value = null
    viewingPublication.value = null
    templateError.value = ''
  }

  async function uploadTemplateImage(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    templateError.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      templateError.value = 'A imagem ultrapassa o limite de 5 MiB.'
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      templateError.value = 'Escolha uma imagem PNG, JPEG ou WebP.'
      return
    }
    templateSaving.value = true
    try {
      const result = await $fetch<{ asset: { id: string; url: string } }>(
        `/api/admin/organizations/${encodeURIComponent(dependencies.selectedOrganizationId.value)}/assets`,
        { method: 'POST', headers: { ...csrfHeaders.value, 'content-type': file.type }, body: file },
      )
      templateForm.imageAssetId = result.asset.id
      imagePreviewUrl.value = result.asset.url
      templateNotice.value = 'Imagem carregada e pronta para a prévia.'
    } catch { templateError.value = 'Não foi possível carregar a imagem. Use PNG, JPEG ou WebP de até 5 MiB.' }
    finally { templateSaving.value = false }
  }

  function removeTemplateImage() {
    delete templateForm.imageAssetId
    imagePreviewUrl.value = ''
  }

  return {
    templateForm, templateEventId, templateLoading, templateSaving, templatePublishing, templateError,
    templateNotice, imagePreviewUrl, previewSize, publishedVersion, viewingPublication,
    draftBeforePublication, templateEvent, displayedTemplate, displayedImageUrl, previewValues,
    resolvedPreview, messagePreview, resetTemplates, openTemplateEditor, closeTemplateEditor, saveTemplateDraft,
    publishTemplate, viewPublishedVersion, editCurrentDraft, uploadTemplateImage, removeTemplateImage,
  }
}
