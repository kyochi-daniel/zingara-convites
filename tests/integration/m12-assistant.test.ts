import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaultTemplate, type AssistantDecision } from '../../packages/contracts/src/index'
import {
  createOrganization,
  assistantContext,
  consumeAssistantQuota,
  executeAssistantDecision,
  executeAssistantPendingCommand,
  readAssistantConversation,
  saveAssistantExchange,
} from '../../packages/core/src/index'
import {
  AssistantConversationModel,
  connectDatabase,
  DeliveryModel,
  EventModel,
  EvolutionConnectionModel,
  GuestModel,
  InvitationModel,
  LoginAttemptModel,
  TemplateVersionModel,
} from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.INVITE_LINK_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m12-link`).digest('base64')
process.env.EVOLUTION_MODE = 'fake'
delete process.env.OPENROUTER_API_KEY
const email = 'm12@example.test'
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m12-admin`).digest('hex')
let api: ChildProcess
let base: string
let cookie: string
let csrf: string
let org: string

async function request(path: string, method = 'GET', body?: unknown, options: {
  authenticated?: boolean; origin?: string; csrf?: string } = {}) {
  return fetch(`${base}${path}`, { method, headers: {
    ...(options.authenticated === false ? {} : { cookie }),
    ...(method === 'GET' ? {} : { origin: options.origin ?? process.env.ADMIN_ORIGIN!,
      'x-csrf-token': options.csrf ?? csrf }),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

async function proposeAndConfirm(
  decision: AssistantDecision,
  message: string,
  currentPending?: Record<string, unknown> | null,
) {
  const proposal = await executeAssistantDecision(org, decision, message, currentPending)
  expect(proposal.pending).toMatchObject({ intent: 'assistant_proposal', proposal: { action: decision.action } })
  const result = await executeAssistantPendingCommand(org, 'confirmo', proposal.pending, 'a'.repeat(24))
  expect(result).not.toBeNull()
  return result!
}

beforeAll(async () => {
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Porta indisponível')
  await new Promise<void>(resolve => server.close(resolve))
  base = `http://127.0.0.1:${address.port}`
  api = spawn(process.execPath, ['apps/api/.output/server/index.mjs'], {
    cwd: process.cwd(), env: { ...process.env, NITRO_PORT: String(address.port) }, stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/health`)).ok) break } catch { /* API iniciando */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const login = await fetch(`${base}/admin/auth/login`, { method: 'POST', headers: {
    origin: process.env.ADMIN_ORIGIN!, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  expect(login.status).toBe(200)
  cookie = login.headers.get('set-cookie')!.split(';')[0]
  csrf = (await login.json() as any).csrfToken
  org = (await (await request('/admin/organizations', 'POST', { name: 'M12' })).json() as any).organization.id
}, 20_000)

afterAll(async () => {
  api?.kill('SIGTERM')
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
}, 20_000)

test('rota exige sessão, origem e CSRF; chave ausente responde no chat e preserva histórico', async () => {
  const path = `/admin/organizations/${org}/assistant`
  expect((await request(path, 'GET', undefined, { authenticated: false })).status).toBe(401)
  expect(await (await request(path)).json()).toEqual({ messages: [], pending: null })
  expect((await request(path, 'POST', { message: 'Olá' }, { authenticated: false })).status).toBe(401)
  expect((await request(path, 'POST', { message: 'Olá' }, { origin: 'https://evil.test' })).status).toBe(403)
  expect((await request(path, 'POST', { message: 'Olá' }, { csrf: 'wrong' })).status).toBe(403)
  expect((await request(path, 'POST', { message: '' })).status).toBe(400)
  const unavailable = await request(path, 'POST', { message: 'token: segredo-total, crie um convite' })
  expect(unavailable.status).toBe(200)
  const body = await unavailable.json() as any
  expect(body.reply).toContain('Nenhuma ação foi executada')
  expect(JSON.stringify(body)).not.toContain('segredo-total')
  expect((await readAssistantConversation('global', org))?.messages).toHaveLength(2)
  const navigation = await request(path, 'POST', { message: 'Abra a página de Eventos.' })
  expect(navigation.status).toBe(200)
  expect(await navigation.json()).toMatchObject({
    reply: 'Abri a área solicitada.', navigation: { type: 'area', area: 'events' },
  })
})

test('rota confirma a proposta persistida sem consultar novamente o OpenRouter', async () => {
  const event = {
    name: 'Confirmação pela rota', location: 'Espaço', address: 'Rua da API',
    startsAt: '2027-05-10T19:00:00-04:00', endsAt: '2027-05-10T22:00:00-04:00',
    rsvpDeadline: '2027-05-09T19:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 0, companionNamesRequired: false,
  }
  await saveAssistantExchange('global', org, 'Crie um evento', 'Revise e confirme.', {
    intent: 'assistant_proposal', requestedWhatsAppSend: false,
    proposal: { action: 'create_event', organizationId: org, event },
  })
  const changed = await request(`/admin/organizations/${org}/assistant`, 'POST', { message: 'Mude a etiqueta' })
  expect(changed.status).toBe(200)
  expect((await changed.json() as any).reply).toContain('proposta pendente')
  expect(await EventModel.countDocuments({ organizationId: org, name: event.name })).toBe(0)
  expect((await readAssistantConversation('global', org))?.pending).toMatchObject({ intent: 'assistant_proposal' })
  const response = await request(`/admin/organizations/${org}/assistant`, 'POST', { message: 'confirmo' })
  expect(response.status).toBe(200)
  expect((await response.json() as any).reply).toContain('Evento criado')
  expect(await EventModel.countDocuments({ organizationId: org, name: event.name })).toBe(1)
  expect((await readAssistantConversation('global', org))?.pending).toBeNull()
})

test('memória fica isolada e limitada a trinta mensagens', async () => {
  for (let index = 0; index < 16; index++) {
    await saveAssistantExchange('global', org, `pergunta ${index}`, `resposta ${index}`)
  }
  expect((await readAssistantConversation('global', org))?.messages).toHaveLength(30)
  expect((await readAssistantConversation('outro-admin', org))?.messages).toEqual([])
  expect(await AssistantConversationModel.countDocuments({ organizationId: org })).toBe(1)
  for (let index = 0; index < 6; index++) expect(await consumeAssistantQuota('quota-admin', org)).toBe(true)
  expect(await consumeAssistantQuota('quota-admin', org)).toBe(false)
  const day = Math.floor(Date.now() / 86_400_000)
  const dailyKey = `assistant:day:${createHash('sha256').update('daily-admin').digest('hex')}:${day}`
  await LoginAttemptModel.create({ _id: dailyKey, count: 100, expiresAt: new Date((day + 2) * 86_400_000) })
  expect(await consumeAssistantQuota('daily-admin', org)).toBe(false)
})

test('convite completo usa regras reais e não grava link secreto', async () => {
  const decision: AssistantDecision = {
    action: 'create_full_invitation', organizationId: org,
    event: {
      name: 'Inauguração', location: 'Loja', address: 'Rua A',
      startsAt: '2027-06-10T19:00:00-04:00', endsAt: '2027-06-10T22:00:00-04:00',
      rsvpDeadline: '2027-06-09T20:00:00-04:00', timeZone: 'America/Campo_Grande',
      companionLimit: 1, companionNamesRequired: true,
    },
    guest: { name: 'Ana', phone: '+5567999999999', tags: [], notes: '', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' },
  }
  const result = await proposeAndConfirm(decision, 'Crie um convite completo')
  expect(result.reply).toContain('Convite completo criado')
  expect(result.navigation).toMatchObject({ type: 'event', area: 'invitations' })
  expect(await EventModel.countDocuments({ organizationId: org, status: 'published' })).toBe(1)
  const publications = await TemplateVersionModel.find({ organizationId: org }).lean()
  expect(publications).toHaveLength(1)
  expect(publications[0].template).toEqual(defaultTemplate)
  expect(await GuestModel.countDocuments({ organizationId: org })).toBe(1)
  expect(await InvitationModel.countDocuments({ organizationId: org })).toBe(1)
  const retried = await proposeAndConfirm(decision, 'Crie o convite completo e envie no WhatsApp')
  expect(retried.reply).toContain('WhatsApp ainda não tem uma conexão ativa')
  expect(retried.navigation).toEqual({ type: 'area', area: 'connection' })
  expect(await EventModel.countDocuments({ organizationId: org, name: decision.event.name })).toBe(1)
  expect(await GuestModel.countDocuments({ organizationId: org })).toBe(1)
  expect(await InvitationModel.countDocuments({ organizationId: org })).toBe(1)
  const secondGuest = await proposeAndConfirm({
    ...decision, guest: { name: 'Bob', phone: '+5567988888888', tags: [], notes: '', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' },
  }, 'Crie outro convite para o mesmo evento')
  expect(secondGuest.reply).toContain('Convite completo criado')
  expect(await EventModel.countDocuments({ organizationId: org, name: decision.event.name })).toBe(1)
  expect(await GuestModel.countDocuments({ organizationId: org })).toBe(2)
  expect(await InvitationModel.countDocuments({ organizationId: org })).toBe(2)
  expect(await TemplateVersionModel.countDocuments({ organizationId: org })).toBe(1)
  expect(await DeliveryModel.countDocuments({ organizationId: org })).toBe(0)
  await saveAssistantExchange('global', org, 'feito', result.reply)
  const stored = await AssistantConversationModel.findOne({ adminId: 'global', organizationId: org })
  expect(JSON.stringify(stored)).not.toContain('/i/')
})

test('chamadas concorrentes reutilizam evento e convidado da operação vencedora', async () => {
  const decision: AssistantDecision = {
    action: 'create_full_invitation', organizationId: org,
    event: {
      name: 'Concorrente', location: 'Salão', address: 'Rua B',
      startsAt: '2027-07-10T19:00:00-04:00', endsAt: '2027-07-10T22:00:00-04:00',
      rsvpDeadline: '2027-07-09T20:00:00-04:00', timeZone: 'America/Campo_Grande',
      companionLimit: 0, companionNamesRequired: false,
    },
    guest: { name: 'Carol', phone: '+5567977777777', tags: [], notes: '', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' },
  }
  const proposal = await executeAssistantDecision(org, decision, 'Crie o convite completo')
  await Promise.all([
    executeAssistantPendingCommand(org, 'confirmo', proposal.pending, 'a'.repeat(24)),
    executeAssistantPendingCommand(org, 'confirmo', proposal.pending, 'a'.repeat(24)),
  ])
  expect(await EventModel.countDocuments({ organizationId: org, name: 'Concorrente' })).toBe(1)
  expect(await GuestModel.countDocuments({ organizationId: org, phone: '+5567977777777' })).toBe(1)
  const event = await EventModel.findOne({ organizationId: org, name: 'Concorrente' })
  expect(await InvitationModel.countDocuments({ organizationId: org, eventId: event!.id })).toBe(1)
})

test('retoma intenção confirmada e deduplica criações simples', async () => {
  const event = {
    name: 'Fluxo confirmado', location: 'Espaço', address: 'Rua C', startsAt: '2027-09-01T19:00:00-04:00',
    endsAt: '2027-09-01T22:00:00-04:00', rsvpDeadline: '2027-08-31T19:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 0, companionNamesRequired: false,
  } as const
  const requested = await executeAssistantDecision(org,
    { action: 'respond', reply: 'O evento foi criado.', pending: { intent: 'evento', fields: { eventAddress: '' } } }, 'Crie um evento')
  expect(requested.pending).toMatchObject({ intent: 'assistant_flow', fields: { authorizedAction: 'event' } })
  expect(requested.reply).toContain('endereço')
  expect(requested.reply).not.toContain('foi criado')
  const proposed = await executeAssistantDecision(org,
    { action: 'create_event', organizationId: org, event }, 'Rua C', requested.pending)
  expect(proposed.reply).toContain('Confirme')
  const confirmed = await executeAssistantPendingCommand(org, 'confirmo', proposed.pending, 'a'.repeat(24))
  expect(confirmed.reply).toContain('Evento criado')
  await proposeAndConfirm({ action: 'create_event', organizationId: org, event }, 'Crie um evento')
  expect(await EventModel.countDocuments({ organizationId: org, name: event.name })).toBe(1)

  const guest = { name: 'Dora', phone: '+5567966666666', tags: [], notes: '', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado' }
  await proposeAndConfirm({ action: 'create_guest', organizationId: org, guest }, 'Cadastre o convidado')
  await proposeAndConfirm({ action: 'create_guest', organizationId: org, guest }, 'Cadastre o convidado')
  expect(await GuestModel.countDocuments({ organizationId: org, phone: guest.phone })).toBe(1)

  const defaultContext = await assistantContext(org, 'Olá')
  expect(defaultContext?.events).toEqual([])
  expect(defaultContext?.guests).toEqual([])
  const eventContext = await assistantContext(org, 'Liste os eventos')
  expect(eventContext?.events.length).toBeGreaterThan(0)
  expect(eventContext?.guests).toEqual([])

  const inviteRequested = await executeAssistantDecision(org,
    { action: 'respond', reply: 'Informe o telefone.', pending: { intent: 'convite', fields: { guestPhone: '' } } },
    'Crie um convite e envie no WhatsApp')
  expect(inviteRequested.pending).toMatchObject({ intent: 'assistant_flow', fields: {
    authorizedAction: 'invitation', requestedWhatsAppSend: true,
  } })
  const inviteDecision: AssistantDecision = {
    action: 'create_full_invitation', organizationId: org,
    event: { ...event, name: 'Fluxo com diagnóstico', startsAt: '2027-10-01T19:00:00-04:00',
      endsAt: '2027-10-01T22:00:00-04:00', rsvpDeadline: '2027-09-30T19:00:00-04:00' },
    guest: { name: 'Eva', phone: '+5567955555555', tags: [], notes: '', whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' },
  }
  const inviteProposal = await executeAssistantDecision(org, inviteDecision, '+5567955555555', inviteRequested.pending)
  const invited = await executeAssistantPendingCommand(org, 'confirmo', inviteProposal.pending, 'a'.repeat(24))
  expect(invited.reply).toContain('Convite completo criado')
  expect(invited.reply).toContain('WhatsApp ainda não tem uma conexão ativa')
  expect(invited.navigation).toEqual({ type: 'area', area: 'connection' })
  expect(await DeliveryModel.countDocuments({ organizationId: org })).toBe(0)
})

test('bloqueia organização divergente, conexão implícita e qualquer trabalho de entrega', async () => {
  const other = await createOrganization({ name: 'Outra' })
  const event = {
    name: 'Forjado', location: 'X', address: 'Y', startsAt: '2027-08-01T20:00:00-04:00',
    endsAt: '2027-08-01T22:00:00-04:00', rsvpDeadline: '2027-07-31T20:00:00-04:00',
    timeZone: 'America/Campo_Grande', companionLimit: 0, companionNamesRequired: false,
  }
  const forged = await executeAssistantDecision(org, { action: 'create_event', organizationId: other.id, event }, 'crie')
  expect(forged.reply).toContain('não pertence')
  expect(await EventModel.countDocuments({ organizationId: other.id })).toBe(0)
  const ambiguous = await executeAssistantDecision(org, { action: 'create_event', organizationId: org, event },
    'Crie um evento na semana que vem')
  expect(ambiguous.reply).toContain('data e hora exatas')
  const beforeInjectedAction = await EventModel.countDocuments({ organizationId: org })
  const injectedAction = await executeAssistantDecision(org,
    { action: 'create_event', organizationId: org, event }, 'Mostre os eventos disponíveis')
  expect(injectedAction.reply).toContain('Não executei')
  expect(await EventModel.countDocuments({ organizationId: org })).toBe(beforeInjectedAction)
  const implicit = await executeAssistantDecision(org, { action: 'prepare_connection', organizationId: org }, 'Como funciona?')
  expect(implicit.reply).toContain('explicitamente')
  const denied = await executeAssistantDecision(org, { action: 'prepare_connection', organizationId: org },
    'Não conecte o WhatsApp, apenas explique.')
  expect(denied.reply).toContain('Não executei')
  const question = await executeAssistantDecision(org, { action: 'prepare_connection', organizationId: org },
    'Como configurar a conexão do WhatsApp?')
  expect(question.reply).toContain('Não executei')
  expect(await EvolutionConnectionModel.countDocuments({ organizationId: org })).toBe(0)
  const status = await executeAssistantDecision(org, { action: 'connection_status', organizationId: org }, 'Envie no WhatsApp')
  expect(status.navigation).toEqual({ type: 'area', area: 'connection' })
  const falseSuccess = await executeAssistantDecision(org, { action: 'respond', reply: 'Criei o evento com sucesso.' }, 'oi')
  expect(falseSuccess.reply).toContain('Ainda não executei')
  const capabilities = await executeAssistantDecision(org, {
    action: 'respond', reply: 'Posso abrir áreas, criar eventos e verificar se a conexão está ativa.',
  }, 'Quais ações você consegue fazer neste painel? Não crie nem envie nada.')
  expect(capabilities.reply).toBe('Posso abrir áreas, criar eventos e verificar se a conexão está ativa.')
  for (const claim of ['O evento foi criado.', 'Tudo pronto; convite feito.', 'A conexão está ativa.']) {
    const claimed = await executeAssistantDecision(org, { action: 'respond', reply: claim }, 'oi')
    expect(claimed.reply).toContain('Ainda não executei')
    expect(claimed.reply).not.toContain(claim)
  }
  const falseSend = await executeAssistantDecision(org, { action: 'respond', reply: 'Mensagem enviada.' }, 'Envie no WhatsApp')
  expect(falseSend.reply).toContain('ainda não tem uma conexão ativa')
  const falseConnection = await executeAssistantDecision(org, { action: 'respond', reply: 'WhatsApp conectado e QR já pronto.' },
    'O WhatsApp está conectado?')
  expect(falseConnection.reply).toContain('ainda não tem uma conexão ativa')
  const prepared = await proposeAndConfirm({ action: 'prepare_connection', organizationId: org },
    'Crie uma nova instância do WhatsApp')
  expect(prepared.navigation).toEqual({ type: 'area', area: 'connection' })
  expect(prepared.reply).not.toMatch(/data:image|[A-Za-z0-9+/=_-]{256,}/)
  expect(await EvolutionConnectionModel.countDocuments({ organizationId: org })).toBe(1)
  expect(await DeliveryModel.countDocuments({ organizationId: org })).toBe(0)
})

test.each([
  'Seu evento foi criado.',
  'Seu convite foi enviado.',
  'Evento criado.',
  'Sua mensagem enviada.',
  'Parabéns, seu evento foi criado.',
  'Não se preocupe, seu evento foi criado.',
])('bloqueia alegação de sucesso não verificada: %s', async claim => {
  const result = await executeAssistantDecision(org, { action: 'respond', reply: claim }, 'oi')
  expect(result.reply).toContain('Ainda não executei')
  expect(result.reply).not.toContain(claim)
})

test.each([
  'Seu evento não foi criado.',
  'Seu convite ainda não foi enviado.',
  'Não criei o evento.',
  'Sua mensagem não foi enviada.',
])('preserva resposta informativa negada: %s', async reply => {
  const result = await executeAssistantDecision(org, { action: 'respond', reply }, 'oi')
  expect(result.reply).toBe(reply)
})

test('ações mutáveis viram proposta e somente a confirmação executa o payload persistido', async () => {
  const invented = {
    name: 'Inventado pelo modelo', description: 'Descrição inventada', location: 'Local inventado', address: 'Rua inventada',
    startsAt: '2027-11-01T19:00:00-04:00', endsAt: '2027-11-01T22:00:00-04:00',
    rsvpDeadline: '2027-10-31T19:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 2, companionNamesRequired: true,
  }
  const proposal = await executeAssistantDecision(org,
    { action: 'create_event', organizationId: org, event: invented }, 'Crie um evento')
  expect(proposal.reply).toContain('Confirme')
  for (const material of ['Inventado pelo modelo', 'Descrição inventada', 'Local inventado', 'Rua inventada',
    invented.startsAt, invented.endsAt, invented.rsvpDeadline, invented.timeZone,
    'limite de acompanhantes=2', 'nomes dos acompanhantes obrigatórios=sim']) {
    expect(proposal.reply).toContain(material)
  }
  expect(proposal.pending).toMatchObject({ intent: 'assistant_proposal', proposal: { action: 'create_event' } })
  expect(await EventModel.countDocuments({ organizationId: org, name: invented.name })).toBe(0)

  const changedByModel = { ...invented, name: 'Payload novo do modelo' }
  const confirmed = await executeAssistantDecision(org,
    { action: 'create_event', organizationId: org, event: changedByModel }, 'confirmo', proposal.pending)
  expect(confirmed.reply).toContain('Evento criado')
  expect(await EventModel.countDocuments({ organizationId: org, name: invented.name })).toBe(1)
  expect(await EventModel.countDocuments({ organizationId: org, name: changedByModel.name })).toBe(0)
})

test('não torna confirmável proposta cujo resumo completo excede o histórico visível', async () => {
  const decision: AssistantDecision = {
    action: 'create_full_invitation', organizationId: org,
    event: {
      name: 'Conteúdo extenso', description: 'Descrição extensa '.repeat(125).slice(0, 2_000),
      location: 'Salão', address: 'Rua longa',
      startsAt: '2028-02-10T19:00:00-04:00', endsAt: '2028-02-10T22:00:00-04:00',
      rsvpDeadline: '2028-02-09T19:00:00-04:00', timeZone: 'America/Campo_Grande',
      companionLimit: 0, companionNamesRequired: false,
    },
    guest: { name: 'Pessoa extensa', phone: '+5567933333333', email: 'extensa@example.test',
      tags: ['vip'], notes: 'Nota extensa '.repeat(167).slice(0, 2_000), whatsappConsent: true,
      authorizationSource: 'Formulário presencial assinado' },
  }
  const result = await executeAssistantDecision(org, decision, 'Crie um convite completo')
  expect(result.reply).toContain('longos demais')
  expect(result.pending).toBeUndefined()
  await saveAssistantExchange('resumo-extenso', org, 'Crie um convite completo', result.reply, result.pending)
  const stored = await readAssistantConversation('resumo-extenso', org)
  expect(stored?.messages.at(-1)?.content).toBe(result.reply)
  expect(stored?.messages.at(-1)?.content.length).toBeLessThanOrEqual(2_000)
  expect(await executeAssistantPendingCommand(org, 'confirmo', stored?.pending)).toBeNull()
  expect(await EventModel.countDocuments({ organizationId: org, name: decision.event.name })).toBe(0)
  expect(await GuestModel.countDocuments({ organizationId: org, phone: decision.guest.phone })).toBe(0)
})

test.each(['não', 'não, obrigado', 'não quero', 'não quero mais', 'deixa', 'deixa pra lá', 'esquece', 'pare', 'cancela'])(
  'cancelamento %s descarta proposta sem criar registro', async cancellation => {
    const event = {
      name: `Cancelado ${cancellation}`, location: 'Espaço', address: 'Rua D',
      startsAt: '2027-12-01T19:00:00-04:00', endsAt: '2027-12-01T22:00:00-04:00',
      rsvpDeadline: '2027-11-30T19:00:00-04:00', timeZone: 'America/Campo_Grande',
      companionLimit: 0, companionNamesRequired: false,
    }
    const proposal = await executeAssistantDecision(org,
      { action: 'create_event', organizationId: org, event }, 'Crie um evento')
    const cancelled = await executeAssistantDecision(org,
      { action: 'create_event', organizationId: org, event }, cancellation, proposal.pending)
    expect(cancelled.reply.toLowerCase()).toContain('cancelei')
    expect(cancelled.pending).toBeUndefined()
    expect(await EventModel.countDocuments({ organizationId: org, name: event.name })).toBe(0)
  },
)

test('todas as mutações aguardam confirmação canônica sem efeitos antecipados', async () => {
  const event = {
    name: 'Proposta completa', location: 'Salão', address: 'Rua E',
    startsAt: '2028-01-10T19:00:00-04:00', endsAt: '2028-01-10T22:00:00-04:00',
    rsvpDeadline: '2028-01-09T19:00:00-04:00', timeZone: 'America/Campo_Grande',
    companionLimit: 0, companionNamesRequired: false,
  }
  const guest = { name: 'Proposta pessoa', phone: '+5567944444444', email: 'pessoa@example.test',
    tags: ['vip'], notes: 'Observação', whatsappConsent: true,
    authorizationSource: 'Formulário presencial assinado' }
  const decisions: Array<{ decision: AssistantDecision, message: string }> = [
    { decision: { action: 'create_guest', organizationId: org, guest }, message: 'Cadastre o convidado' },
    { decision: { action: 'create_invitation', organizationId: org,
      eventId: 'a'.repeat(24), guestId: 'b'.repeat(24), expiresAt: '2028-01-09T18:00:00-04:00' },
    message: 'Crie o convite' },
    { decision: { action: 'create_full_invitation', organizationId: org, event, guest },
      message: 'Crie um convite completo' },
    { decision: { action: 'prepare_connection', organizationId: org },
      message: 'Crie uma nova instância do WhatsApp' },
  ]
  const before = {
    events: await EventModel.countDocuments({ organizationId: org }),
    guests: await GuestModel.countDocuments({ organizationId: org }),
    invitations: await InvitationModel.countDocuments({ organizationId: org }),
    connections: await EvolutionConnectionModel.countDocuments({ organizationId: org }),
  }
  for (const { decision, message } of decisions) {
    const proposal = await executeAssistantDecision(org, decision, message)
    expect(proposal.pending).toMatchObject({ intent: 'assistant_proposal', proposal: { action: decision.action } })
    const ambiguous = await executeAssistantPendingCommand(org, 'sim', proposal.pending)
    expect(ambiguous?.reply).toContain('proposta pendente')
    expect(ambiguous?.pending).toMatchObject({ intent: 'assistant_proposal' })
  }
  expect(await EventModel.countDocuments({ organizationId: org })).toBe(before.events)
  expect(await GuestModel.countDocuments({ organizationId: org })).toBe(before.guests)
  expect(await InvitationModel.countDocuments({ organizationId: org })).toBe(before.invitations)
  expect(await EvolutionConnectionModel.countDocuments({ organizationId: org })).toBe(before.connections)
})
