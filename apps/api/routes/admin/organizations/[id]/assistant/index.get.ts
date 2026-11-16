import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { readAssistantConversation } from '@zingara/core'
import { requireAdmin } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await requireAdmin(event)
  const conversation = await readAssistantConversation(session.admin.id, getRouterParam(event, 'id') || '')
  if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  return conversation
})
