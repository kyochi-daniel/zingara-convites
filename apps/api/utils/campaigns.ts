import { createError, getRouterParam, setHeader, type H3Event } from 'h3'
import { requireAdmin, requireAdminOrigin, requireCsrf } from './admin'

export function campaignScope(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  return {
    organizationId: getRouterParam(event, 'id') || '',
    eventId: getRouterParam(event, 'eventId') || '',
    campaignId: getRouterParam(event, 'campaignId') || '',
  }
}

export async function requireCampaignRead(event: H3Event) {
  await requireAdmin(event)
  return campaignScope(event)
}

export async function requireCampaignMutation(event: H3Event) {
  requireAdminOrigin(event)
  const session = await requireAdmin(event)
  requireCsrf(event, session.csrfToken)
  return campaignScope(event)
}

export function campaignError(error: string): never {
  if (error === 'NOT_FOUND') throw createError({ statusCode: 404, statusMessage: 'Campanha ou evento não encontrado' })
  if (error === 'INVALID') throw createError({ statusCode: 400, statusMessage: 'Dados da campanha inválidos' })
  throw createError({ statusCode: 409, statusMessage: 'Campanha, prévia ou conexão indisponível' })
}
