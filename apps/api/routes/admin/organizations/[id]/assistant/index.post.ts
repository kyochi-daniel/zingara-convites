import { createError, defineEventHandler, getRouterParam, setHeader, setResponseStatus } from 'h3'
import { assistantMessageInput, sanitizeAssistantText, type AssistantDecision } from '@zingara/contracts'
import {
  assistantContext,
  consumeAssistantQuota,
  executeAssistantDecision,
  executeAssistantPendingCommand,
  readAssistantConversation,
  saveAssistantExchange,
} from '@zingara/core'
import { requestAssistantDecision } from '../../../../../utils/assistant'
import { readJson, requireAdmin, requireAdminOrigin, requireCsrf } from '../../../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  const parsed = assistantMessageInput.safeParse(await readJson(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Mensagem inválida' })
  const organizationId = getRouterParam(event, 'id') || ''
  const message = sanitizeAssistantText(parsed.data.message)
  const [conversation, context] = await Promise.all([
    readAssistantConversation(session.admin.id, organizationId),
    assistantContext(organizationId, message),
  ])
  if (!conversation || !context) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  if (!await consumeAssistantQuota(session.admin.id, organizationId)) {
    throw createError({ statusCode: 429, statusMessage: 'Aguarde antes de enviar outra mensagem' })
  }
  try {
    const pendingCommand = await executeAssistantPendingCommand(organizationId, message, conversation.pending, session.admin.id)
    if (pendingCommand) {
      const saved = await saveAssistantExchange(
        session.admin.id, organizationId, message, pendingCommand.reply, pendingCommand.pending,
      )
      if (!saved) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
      return { messages: saved.messages, reply: pendingCommand.reply,
        ...(pendingCommand.navigation ? { navigation: pendingCommand.navigation } : {}) }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const reply = 'Não consegui confirmar a execução. Verifique os registros antes de tentar novamente.'
    const saved = await saveAssistantExchange(session.admin.id, organizationId, message, reply)
    setResponseStatus(event, 500)
    return { messages: saved?.messages ?? conversation.messages, reply }
  }
  let decision: AssistantDecision
  try {
    decision = await requestAssistantDecision([
      ...conversation.messages.map((item: { role: 'user' | 'assistant', content: string }) => ({
        role: item.role, content: item.content,
      })),
      { role: 'user', content: message },
    ], { ...context, pending: conversation.pending })
  } catch {
    const reply = 'O assistente está temporariamente indisponível. Nenhuma ação foi executada; tente novamente em instantes.'
    const saved = await saveAssistantExchange(session.admin.id, organizationId, message, reply)
    return { messages: saved?.messages ?? conversation.messages, reply }
  }
  try {
    const result = await executeAssistantDecision(organizationId, decision, message, conversation.pending, session.admin.id)
    const saved = await saveAssistantExchange(session.admin.id, organizationId, message, result.reply, result.pending)
    if (!saved) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
    return { messages: saved.messages, reply: result.reply, ...(result.navigation ? { navigation: result.navigation } : {}) }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const reply = 'Não consegui confirmar a execução. Verifique os registros antes de tentar novamente.'
    const saved = await saveAssistantExchange(session.admin.id, organizationId, message, reply)
    setResponseStatus(event, 500)
    return { messages: saved?.messages ?? conversation.messages, reply }
  }
})
