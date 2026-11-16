import { randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { checkEvolutionNumber, createEvolutionConnection, previewEvolutionNumbers, selectActiveConnection, verifyEvolutionNumbers } from '../../packages/core/src/index'
import { connectDatabase, EvolutionConnectionModel, LoginAttemptModel, NumberVerificationModel, OrganizationModel } from '../../packages/database/src/index'

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_MODE = 'fake'
process.env.EVOLUTION_BASE_URL = 'https://evolution.number.test'
delete process.env.EVOLUTION_API_KEY
delete process.env.EVOLUTION_CONTROL_REAL_ENABLED
let org: string
let other: string
let connection: string
let cloud: string
const phone = '+5567999999999'

beforeAll(async () => {
  await connectDatabase()
  org = String((await OrganizationModel.create({ name: 'Números' }))._id)
  other = String((await OrganizationModel.create({ name: 'Outra' }))._id)
  const baileys = await createEvolutionConnection(org, { channel: 'baileys' })
  const official = await createEvolutionConnection(org, { channel: 'cloud', metaToken: 'meta-number-test-token',
    phoneNumberId: '123456789', businessId: '234567890' })
  if (!('connection' in baileys) || !('connection' in official)) throw new Error('Reserva falhou')
  connection = baileys.connection.id
  cloud = official.connection.id
  await EvolutionConnectionModel.updateMany({ organizationId: org }, { $set: { state: 'ready' } })
})

afterAll(async () => {
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
})

test('prévia é local, mostra formato e capacidade, sem consulta ou consumo de quota', async () => {
  const network = vi.spyOn(globalThis, 'fetch')
  expect(await previewEvolutionNumbers(org, connection, { phones: [phone, '123', phone] })).toMatchObject({
    channel: 'baileys', lookupSupported: true, mode: 'fake', results: [
      { phone, state: 'not_checked' }, { phone: '123', state: 'invalid_format' }, { phone, state: 'not_checked' },
    ],
  })
  expect(await previewEvolutionNumbers(org, cloud, { phones: [phone] })).toMatchObject({
    lookupSupported: false, results: [{ phone, state: 'unsupported' }],
  })
  expect(network).not.toHaveBeenCalled()
  expect(await LoginAttemptModel.countDocuments()).toBe(0)
  network.mockRestore()
})

test('consulta exige confirmação, conexão pronta, organização e instalação próprias', async () => {
  expect(await verifyEvolutionNumbers(org, connection, { phones: [phone] } as any)).toEqual({ error: 'INVALID' })
  expect(await verifyEvolutionNumbers(other, connection, { phones: [phone], confirm: true })).toEqual({ error: 'NOT_FOUND' })
  expect(await previewEvolutionNumbers(org, 'foreign-app', { phones: [phone] })).toEqual({ error: 'NOT_FOUND' })
  expect(await verifyEvolutionNumbers(org, cloud, { phones: [phone], confirm: true })).toEqual({ error: 'UNSUPPORTED' })
  expect(await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })).toEqual({ error: 'CONFLICT' })
  await EvolutionConnectionModel.updateOne({ _id: connection }, { $set: { state: 'reserved' } })
  expect(await checkEvolutionNumber(org, connection, phone)).toEqual({ error: 'UNAVAILABLE' })
  await EvolutionConnectionModel.updateOne({ _id: connection }, { $set: { state: 'ready', installationId: 'wrong' } })
  expect(await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })).toEqual({ error: 'NOT_FOUND' })
  const { createHash } = await import('node:crypto')
  await EvolutionConnectionModel.updateOne({ _id: connection }, { $set: {
    installationId: createHash('sha256').update(process.env.EVOLUTION_BASE_URL!).digest('hex'),
  } })
})

test('consulta deduplica números e compartilha quota com diagnóstico individual', async () => {
  await selectActiveConnection(org, connection)
  const result = await verifyEvolutionNumbers(org, connection, { phones: [phone, phone], confirm: true })
  expect(result).toMatchObject({ mode: 'fake', results: [{ phone, state: 'registered' }, { phone, state: 'registered' }] })
  expect(result).toMatchObject({ connection: { id: connection, revision: 1 }, results: [
    { checkedAt: expect.any(String), connection: { id: connection, revision: 1 } },
    { checkedAt: expect.any(String), connection: { id: connection, revision: 1 } },
  ] })
  expect(await LoginAttemptModel.findOne({ _id: /^evolution-number:/ })).toHaveProperty('count', 1)
  const outcomes = await Promise.all(Array.from({ length: 15 }, (_, i) => checkEvolutionNumber(org, connection, `+55679999998${String(i).padStart(2, '0')}`)))
  expect(outcomes.filter(item => 'exists' in item)).toHaveLength(9)
  expect(outcomes.filter(item => 'error' in item && item.error === 'RATE_LIMIT')).toHaveLength(6)
  expect(await verifyEvolutionNumbers(org, connection, { phones: ['+5567999999777'], confirm: true })).toMatchObject({
    results: [{ state: 'rate_limited' }],
  })
  const cached = await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })
  expect(cached).toMatchObject({ results: [{ state: 'registered', cached: true }] })
  expect('results' in cached && 'results' in result && cached.results[0].checkedAt).toBe('results' in result && result.results[0].checkedAt)
  await NumberVerificationModel.updateMany({}, { $set: { expiresAt: new Date(0) } })
  expect(await checkEvolutionNumber(org, connection, phone)).toMatchObject({ error: 'RATE_LIMIT' })
})

test('quota diária e falha do provedor nunca viram número registrado', async () => {
  await LoginAttemptModel.deleteMany({})
  await NumberVerificationModel.deleteMany({})
  const day = Math.floor(Date.now() / 86_400_000)
  await LoginAttemptModel.create({ _id: `evolution-number-day:${org}:${day}`, count: 100, expiresAt: new Date(Date.now() + 86_400_000) })
  const limited = await checkEvolutionNumber(org, connection, phone)
  expect(limited).toMatchObject({ error: 'RATE_LIMIT', retryAfterSeconds: expect.any(Number) })
  expect(await checkEvolutionNumber(org.toUpperCase(), connection, phone)).toMatchObject({ error: 'RATE_LIMIT' })
  expect(await LoginAttemptModel.countDocuments({ _id: new RegExp(`^evolution-number-day:${org}:`) })).toBe(1)
  const remaining = Math.max(1, Math.ceil(((day + 1) * 86_400_000 - Date.now()) / 1000))
  expect('retryAfterSeconds' in limited && limited.retryAfterSeconds).toBeGreaterThanOrEqual(remaining)
  await LoginAttemptModel.deleteMany({})
  process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider-secret'))
  try {
    const result = await verifyEvolutionNumbers(org, connection, { phones: [phone, '+5567999999998'], confirm: true })
    expect(result).toMatchObject({ results: [{ state: 'unavailable' }, { state: 'not_checked' }] })
    expect(JSON.stringify(result)).not.toContain('provider-secret')
    expect(network).toHaveBeenCalledTimes(1)
  } finally { network.mockRestore(); delete process.env.EVOLUTION_CONTROL_REAL_ENABLED }
})

test('somente resposta negativa explícita produz not_registered; cache respeita modo, revisão e conexão ativa', async () => {
  await LoginAttemptModel.deleteMany({})
  await NumberVerificationModel.deleteMany({})
  await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })
  process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
  let lookups = 0
  let malformed = false
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(options?.headers).not.toHaveProperty('apikey', 'global-admin-key')
    if (new URL(String(url)).pathname.includes('/connectionState/')) return new Response(JSON.stringify({ instance: { state: 'open' } }))
    lookups++
    const number = (JSON.parse(String(options?.body)) as { numbers: string[] }).numbers[0]
    return new Response(JSON.stringify(malformed ? [] : [{ number, exists: false }]))
  })
  try {
    expect(await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })).toMatchObject({
      mode: 'real', results: [{ state: 'not_registered', cached: false }],
    })
    expect(await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })).toMatchObject({
      results: [{ state: 'not_registered', cached: true }],
    })
    expect(lookups).toBe(1)
    await selectActiveConnection(org, cloud)
    expect(await checkEvolutionNumber(org, connection, phone)).toEqual({ error: 'CONFLICT' })
    await selectActiveConnection(org, connection)
    expect(await verifyEvolutionNumbers(org, connection, { phones: [phone], confirm: true })).toMatchObject({
      results: [{ state: 'not_registered', cached: false, connection: { revision: 3 } }],
    })
    expect(lookups).toBe(2)
    malformed = true
    expect(await verifyEvolutionNumbers(org, connection, { phones: ['+5567999999555'], confirm: true })).toMatchObject({
      results: [{ state: 'unavailable' }],
    })
    expect(await NumberVerificationModel.countDocuments()).toBe(3)
  } finally { network.mockRestore(); delete process.env.EVOLUTION_CONTROL_REAL_ENABLED }
})
