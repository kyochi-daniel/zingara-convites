import { createError, defineEventHandler, getRouterParam } from 'h3'
import { csvPreviewInput, guestFilePreviewInput } from '@zingara/contracts'
import { previewGuestsCsv, previewGuestsFile } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'
import { consumeDocumentPreviewQuota, readGuestImportJson } from '../../../../../utils/guest-import'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = csvPreviewInput.or(guestFilePreviewInput).safeParse(await readGuestImportJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Arquivo inválido. Use CSV, TXT, DOCX ou DOC.' })
  if ('file' in parsed.data && /\.docx?$/i.test(parsed.data.file.name)) await consumeDocumentPreviewQuota(session.admin.id)
  let preview
  try { preview = await ('file' in parsed.data ? previewGuestsFile(getRouterParam(event, 'id') || '', parsed.data) : previewGuestsCsv(getRouterParam(event, 'id') || '', parsed.data)) }
  catch (error) {
    if (error instanceof SyntaxError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
  if (!preview) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return preview
})
