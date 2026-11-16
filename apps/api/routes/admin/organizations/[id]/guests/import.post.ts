import { createError, defineEventHandler, getRouterParam } from 'h3'
import { csvImportInput, guestFileImportInput } from '@zingara/contracts'
import { importGuestsCsv, importGuestsFile } from '@zingara/core'
import { requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'
import { consumeDocumentPreviewQuota, readGuestImportJson } from '../../../../../utils/guest-import'

export default defineEventHandler(async event => {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = csvImportInput.or(guestFileImportInput).safeParse(await readGuestImportJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Importação inválida. Confira seleção e fonte da autorização WhatsApp.' })
  if ('file' in parsed.data && /\.docx?$/i.test(parsed.data.file.name)) await consumeDocumentPreviewQuota(session.admin.id)
  let imported
  try { imported = await ('file' in parsed.data ? importGuestsFile(getRouterParam(event, 'id') || '', parsed.data, session.admin.id) : importGuestsCsv(getRouterParam(event, 'id') || '', parsed.data)) }
  catch (error) {
    if (error instanceof SyntaxError) throw createError({ statusCode: 400, statusMessage: error.message })
    throw error
  }
  if (!imported) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return imported
})
