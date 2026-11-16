import { createHash, randomUUID } from 'node:crypto'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createEvolutionClient, createEvolutionInstallationClient, EvolutionHttpError, proveEvolutionInstance } from '../../packages/integrations/src/evolution'
import { connectDatabase, EvolutionConnectionModel, EvolutionInstallationModel } from '../../packages/database/src/index'
import { bindEvolutionConnection, connectEvolution, createEvolutionConnection, createOrganization,
  listEvolutionInventory, provisionEvolutionConnection, readEvolutionInstallation, saveEvolutionInstallation } from '../../packages/core/src/index'

loadEnvFile('.env')
const originalEnvironment = {
  baseUrl: process.env.EVOLUTION_BASE_URL, apiKey: process.env.EVOLUTION_API_KEY,
  controlEnabled: process.env.EVOLUTION_CONTROL_REAL_ENABLED, inviteOrigin: process.env.INVITE_ORIGIN,
}
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_test_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
process.env.EVOLUTION_CREDENTIAL_KEY = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-core`).digest('base64')
process.env.EVOLUTION_MODE = 'fake'
process.env.EVOLUTION_BASE_URL = 'https://evolution.m11.test'
delete process.env.EVOLUTION_API_KEY
const baseUrl = process.env.EVOLUTION_BASE_URL
let organizationId: string
let otherOrganizationId: string
let verifiedMode: string | undefined
const fakeAdmin = { createClient: (config: Parameters<typeof createEvolutionInstallationClient>[0]) =>
  { verifiedMode = config.mode; return createEvolutionInstallationClient({ ...config, mode: 'fake' as const }) } }
const fakeProof = { proveInstance: (config: Parameters<typeof proveEvolutionInstance>[0]) =>
  proveEvolutionInstance({ ...config, mode: 'fake' as const }) }

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeAll(async () => {
  organizationId = (await createOrganization({ name: 'M11' })).id
  otherOrganizationId = (await createOrganization({ name: 'M11 outra' })).id
})

afterAll(async () => {
  const db = await connectDatabase()
  await db.connection.dropDatabase()
  await db.disconnect()
  restoreEnvironment('EVOLUTION_BASE_URL', originalEnvironment.baseUrl)
  restoreEnvironment('EVOLUTION_API_KEY', originalEnvironment.apiKey)
  restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', originalEnvironment.controlEnabled)
  restoreEnvironment('INVITE_ORIGIN', originalEnvironment.inviteOrigin)
})

test('instalação direta do ambiente exige verificação real e não expõe a chave', async () => {
  const apiKey = process.env.EVOLUTION_API_KEY
  const controlFlag = process.env.EVOLUTION_CONTROL_REAL_ENABLED
  process.env.EVOLUTION_API_KEY = 'environment-global-secret'
  delete process.env.EVOLUTION_CONTROL_REAL_ENABLED
  let verifiedMode: string | undefined
  try {
    const dependencies = {
      createClient: config => {
        verifiedMode = config.mode
        return { verify: async () => {}, listInstances: async () => [] }
      },
    }
    const installation = await readEvolutionInstallation(dependencies)
    expect(installation).toMatchObject({ baseUrl, verifiedAt: expect.any(String), controlEnabled: false })
    expect(verifiedMode).toBe('real')
    expect(JSON.stringify(installation)).not.toContain(process.env.EVOLUTION_API_KEY)

    process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
    expect(await readEvolutionInstallation(dependencies)).toMatchObject({ controlEnabled: true })
  } finally {
    if (controlFlag === undefined) delete process.env.EVOLUTION_CONTROL_REAL_ENABLED
    else process.env.EVOLUTION_CONTROL_REAL_ENABLED = controlFlag
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
  }
})

test('instalação direta rejeita chave inválida e URL insegura sem anunciar autenticação', async () => {
  const allowedBaseUrl = process.env.EVOLUTION_BASE_URL
  const apiKey = process.env.EVOLUTION_API_KEY
  process.env.EVOLUTION_API_KEY = 'invalid-global-secret'
  let clientCalls = 0
  try {
    await expect(readEvolutionInstallation({ createClient: () => {
      clientCalls += 1
      return { verify: async () => { throw new Error('authentication failed') }, listInstances: async () => [] }
    } })).rejects.toThrow('Instalação Evolution indisponível')
    expect(clientCalls).toBe(1)

    process.env.EVOLUTION_BASE_URL = 'http://evolution.m11.test'
    await expect(readEvolutionInstallation({ createClient: () => {
      clientCalls += 1
      return { verify: async () => {}, listInstances: async () => [] }
    } })).rejects.toThrow('Instalação Evolution indisponível')
    expect(clientCalls).toBe(1)
  } finally {
    process.env.EVOLUTION_BASE_URL = allowedBaseUrl
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
  }
})

test('instalação direta com controle desligado não reserva conexão fake', async () => {
  const apiKey = process.env.EVOLUTION_API_KEY
  process.env.EVOLUTION_API_KEY = 'environment-global-secret'
  try {
    expect(await createEvolutionConnection(otherOrganizationId, { channel: 'baileys' }))
      .toEqual({ error: 'UNAVAILABLE' })
    expect(await EvolutionConnectionModel.findOne({ organizationId: otherOrganizationId })).toBeNull()
  } finally {
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
  }
})

test('instalação testa origem e cifra chave antes de mostrar estado', async () => {
  expect(await saveEvolutionInstallation({ baseUrl: 'https://evil.test', adminApiKey: 'global-secret' }))
    .toEqual({ error: 'INVALID' })
  expect(await readEvolutionInstallation()).toBeNull()
  expect(await saveEvolutionInstallation({ baseUrl, adminApiKey: 'wrong-key' }, {
    createClient: config => ({ ...createEvolutionInstallationClient({ ...config, mode: 'fake' }),
      verify: async () => { throw new Error('authentication failed') } }),
  })).toEqual({ error: 'UNAVAILABLE' })
  expect(await readEvolutionInstallation()).toBeNull()
  const saved = await saveEvolutionInstallation({ baseUrl, adminApiKey: 'global-secret' }, fakeAdmin)
  expect(saved).toMatchObject({ installation: { baseUrl } })
  expect(verifiedMode).toBe('real')
  expect(process.env.EVOLUTION_MODE).toBe('fake')
  expect(JSON.stringify(saved)).not.toContain('global-secret')
  expect(await readEvolutionInstallation(fakeAdmin)).toMatchObject({ baseUrl })
  await expect(readEvolutionInstallation({ createClient: () => ({
    verify: async () => { throw new Error('authentication failed') }, listInstances: async () => [],
  }) })).rejects.toThrow('Instalação Evolution indisponível')
  const apiKey = process.env.EVOLUTION_API_KEY
  process.env.EVOLUTION_API_KEY = 'invalid-environment-key'
  let environmentClientCalls = 0
  try {
    await expect(readEvolutionInstallation({ createClient: () => {
      environmentClientCalls += 1
      return { verify: async () => { throw new Error('authentication failed') }, listInstances: async () => [] }
    } })).rejects.toThrow('Instalação Evolution indisponível')
    expect(environmentClientCalls).toBe(1)

    const environmentKey = process.env.EVOLUTION_API_KEY!
    const direct = await readEvolutionInstallation({ createClient: config => {
      environmentClientCalls += 1
      expect(config.adminApiKey).toBe(environmentKey)
      return { verify: async () => {}, listInstances: async () => [] }
    } })
    expect(direct).toMatchObject({ baseUrl, controlEnabled: false })
    expect(JSON.stringify(direct)).not.toContain(environmentKey)
    expect(environmentClientCalls).toBe(2)
  } finally {
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
  }
  const stored = await EvolutionInstallationModel.findById('global').select('+apiKeyCiphertext')
  expect(stored?.apiKeyCiphertext).not.toContain('global-secret')
})

test('fallback Mongo exige EVOLUTION_BASE_URL como allowlist antes de usar a chave cifrada', async () => {
  const allowedBaseUrl = process.env.EVOLUTION_BASE_URL
  let clientCalls = 0
  delete process.env.EVOLUTION_BASE_URL
  try {
    await expect(readEvolutionInstallation({ createClient: () => {
      clientCalls += 1
      return { verify: async () => {}, listInstances: async () => [] }
    } })).rejects.toThrow('Instalação Evolution indisponível')
    expect(clientCalls).toBe(0)
  } finally {
    restoreEnvironment('EVOLUTION_BASE_URL', allowedBaseUrl)
  }
})

test('EVOLUTION_BASE_URL guia o runtime sem chave administrativa no ambiente', async () => {
  const allowedBaseUrl = process.env.EVOLUTION_BASE_URL
  const controlFlag = process.env.EVOLUTION_CONTROL_REAL_ENABLED
  const runtimeBaseUrl = 'https://runtime.m11.test'
  process.env.EVOLUTION_BASE_URL = runtimeBaseUrl
  process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
  try {
    const created = await createEvolutionConnection(otherOrganizationId, { channel: 'baileys' })
    expect(created).toHaveProperty('connection')
    const connection = await EvolutionConnectionModel.findOne({ organizationId: otherOrganizationId }).select('installationId')
    expect(connection?.installationId).toBe(createHash('sha256').update(runtimeBaseUrl).digest('hex'))
    await EvolutionConnectionModel.deleteMany({ organizationId: otherOrganizationId })
  } finally {
    restoreEnvironment('EVOLUTION_BASE_URL', allowedBaseUrl)
    restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', controlFlag)
  }
})

test('inventário rejeita token individual antes de listar instâncias', async () => {
  const apiKey = process.env.EVOLUTION_API_KEY
  process.env.EVOLUTION_API_KEY = 'individual-instance-token'
  let listCalls = 0
  try {
    expect(await listEvolutionInventory(organizationId, { createClient: () => ({
      verify: async () => { throw new Error('global credential required') },
      listInstances: async () => { listCalls += 1; return [] },
    }) })).toEqual({ error: 'UNAVAILABLE' })
    expect(listCalls).toBe(0)
  } finally {
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
  }
})

test('operações revalidam origem e identidade persistidas antes de criar cliente', async () => {
  const installationId = createHash('sha256').update(new URL(baseUrl).origin).digest('hex')
  const apiKey = process.env.EVOLUTION_API_KEY
  const controlFlag = process.env.EVOLUTION_CONTROL_REAL_ENABLED
  process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
  expect(await createEvolutionConnection(otherOrganizationId, { channel: 'baileys' })).toHaveProperty('connection')
  restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', controlFlag)
  let clientCalls = 0
  const createClient = (config: Parameters<typeof createEvolutionInstallationClient>[0]) => {
    clientCalls += 1
    return createEvolutionInstallationClient({ ...config, mode: 'fake' })
  }
  try {
    process.env.EVOLUTION_BASE_URL = 'https://rotated.m11.test'
    process.env.EVOLUTION_API_KEY = 'rotated-environment-key'
    await expect(readEvolutionInstallation({ createClient })).rejects.toThrow('Instalação Evolution indisponível')
    expect(clientCalls).toBe(0)
    delete process.env.EVOLUTION_API_KEY
    expect(await listEvolutionInventory(organizationId, { createClient })).toEqual({ error: 'UNAVAILABLE' })
    expect(clientCalls).toBe(0)

    process.env.EVOLUTION_BASE_URL = baseUrl
    await EvolutionInstallationModel.updateOne({ _id: 'global' }, { $set: { installationId: '0'.repeat(64) } })
    expect(await listEvolutionInventory(organizationId, { createClient })).toEqual({ error: 'UNAVAILABLE' })
    expect(clientCalls).toBe(0)

    const alteredOrigin = 'https://altered.m11.test'
    await EvolutionInstallationModel.updateOne({ _id: 'global' }, { $set: { origin: alteredOrigin,
      installationId: createHash('sha256').update(alteredOrigin).digest('hex') } })
    expect(await listEvolutionInventory(organizationId, { createClient })).toEqual({ error: 'UNAVAILABLE' })
    expect(clientCalls).toBe(0)
  } finally {
    process.env.EVOLUTION_BASE_URL = baseUrl
    restoreEnvironment('EVOLUTION_API_KEY', apiKey)
    restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', controlFlag)
    await EvolutionInstallationModel.updateOne({ _id: 'global' }, { $set: { origin: baseUrl, installationId } })
  }
})

test('inventário protege instância externa até token provar identidade exata', async () => {
  const name = `zingara-external-${randomUUID()}`
  const external = createEvolutionClient({ baseUrl, instanceName: name, token: 'instance-secret', channel: 'baileys', mode: 'fake' })
  await external.createInstance()
  const inventory = await listEvolutionInventory(organizationId, fakeAdmin)
  expect(inventory).toMatchObject({ instances: [{ instanceName: name, ownership: 'protegida' }] })
  expect(await listEvolutionInventory('000000000000000000000000', fakeAdmin)).toEqual({ error: 'NOT_FOUND' })
  expect(JSON.stringify(inventory)).not.toContain('instance-secret')
  expect(await connectEvolution(organizationId, name)).toEqual({ error: 'NOT_FOUND' })
  expect(await bindEvolutionConnection(organizationId,
    { channel: 'baileys', instanceName: 'other-application', token: 'instance-secret', confirm: true }))
    .toEqual({ error: 'INVALID' })
  expect(await bindEvolutionConnection(organizationId,
    { channel: 'baileys', instanceName: name, token: 'global-secret', confirm: true }))
    .toEqual({ error: 'INVALID' })
  const wrong = await bindEvolutionConnection(organizationId,
    { channel: 'baileys', instanceName: name, token: 'wrong', confirm: true }, fakeProof)
  expect(wrong).toEqual({ error: 'INVALID' })
  expect((await listEvolutionInventory(organizationId, fakeAdmin)).instances[0]).toMatchObject({ ownership: 'protegida' })
  const bound = await bindEvolutionConnection(organizationId,
    { channel: 'baileys', instanceName: name, token: 'instance-secret', confirm: true }, fakeProof)
  expect(bound).toMatchObject({ connection: { instanceName: name, state: 'reserved' } })
  expect(JSON.stringify(bound)).not.toContain('instance-secret')
  expect((await listEvolutionInventory(organizationId, fakeAdmin)).instances[0])
    .toMatchObject({ ownership: 'propria', connectionId: bound.connection.id, localState: 'reserved' })
  expect((await listEvolutionInventory(otherOrganizationId, fakeAdmin)).instances[0])
    .toMatchObject({ ownership: 'protegida' })
  expect(JSON.stringify(await listEvolutionInventory(otherOrganizationId, fakeAdmin))).not.toContain(bound.connection.id)
  expect(await bindEvolutionConnection(organizationId,
    { channel: 'baileys', instanceName: name, token: 'instance-secret', confirm: true }, fakeProof)).toEqual({ error: 'CONFLICT' })
})

test('controle real pode provisionar sem liberar modo de envio real', async () => {
  const inviteOrigin = process.env.INVITE_ORIGIN
  const controlFlag = process.env.EVOLUTION_CONTROL_REAL_ENABLED
  process.env.INVITE_ORIGIN = 'https://invite.m11.test'
  try {
    delete process.env.EVOLUTION_CONTROL_REAL_ENABLED
    expect(await createEvolutionConnection(otherOrganizationId, { channel: 'baileys' }))
      .toEqual({ error: 'UNAVAILABLE' })
    process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
    const created = await createEvolutionConnection(otherOrganizationId, { channel: 'baileys' })
    expect('connection' in created).toBe(true)
    if (!('connection' in created)) return
    let controlMode: string | undefined
    let adminPreflight = false
    const result = await provisionEvolutionConnection(otherOrganizationId, created.connection.id, {
      createClient: config => {
        controlMode = config.mode
        const client = createEvolutionClient({ ...config, mode: 'fake' })
        return { ...client,
          getInstanceAsAdmin: async () => { adminPreflight = true; return client.getInstance() },
          getInstance: async () => { if (!adminPreflight) throw new Error('Token individual ainda não existe'); return client.getInstance() },
        }
      },
    })
    expect(result).toMatchObject({ connection: { state: 'ready' } })
    expect(adminPreflight).toBe(true)
    expect(controlMode).toBe('real')
    expect(process.env.EVOLUTION_MODE).toBe('fake')
    expect(process.env.EVOLUTION_REAL_SEND_ENABLED).not.toBe('1')

    let qrReads = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = new URL(url).pathname
      if (path.endsWith(`/instance/connectionState/${created.connection.instanceName}`)) {
        return new Response(JSON.stringify({ instance: { state: 'connecting' } }))
      }
      if (path.endsWith(`/instance/connect/${created.connection.instanceName}`)) {
        qrReads += 1
        return new Response(JSON.stringify({ base64: 'data:image/png;base64,AAAA' }))
      }
      throw new Error(`Unexpected Evolution path: ${path}`)
    }))
    expect(await connectEvolution(otherOrganizationId, created.connection.id))
      .toMatchObject({ status: { state: 'connecting', qrCode: 'data:image/png;base64,AAAA' } })
    expect(qrReads).toBe(1)
    vi.unstubAllGlobals()

    let remoteReads = 0
    expect(await provisionEvolutionConnection(otherOrganizationId, created.connection.id, {
      createClient: config => {
        remoteReads += 1
        return createEvolutionClient({ ...config, token: 'missing-remote-instance-token', mode: 'fake' })
      },
    })).toEqual({ error: 'UNAVAILABLE' })
    expect(remoteReads).toBe(1)
  } finally {
    vi.unstubAllGlobals()
    restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', controlFlag)
    restoreEnvironment('INVITE_ORIGIN', inviteOrigin)
  }
})

test('provisionamento não assume posse de uma instância encontrada pela chave global', async () => {
  const controlFlag = process.env.EVOLUTION_CONTROL_REAL_ENABLED
  process.env.EVOLUTION_CONTROL_REAL_ENABLED = '1'
  try {
    const organization = await createOrganization({ name: 'Colisão de instância' })
    const created = await createEvolutionConnection(organization.id, { channel: 'baileys' })
    expect(created).toHaveProperty('connection')
    if (!('connection' in created)) return
    const foreign = createEvolutionClient({ baseUrl, instanceName: created.connection.instanceName,
      token: 'foreign-instance-token', channel: 'baileys', mode: 'fake' })
    await foreign.createInstance()
    expect(await provisionEvolutionConnection(organization.id, created.connection.id, {
      createClient: config => createEvolutionClient({ ...config, mode: 'fake' }),
    })).toEqual({ error: 'CONFLICT' })
    expect(await provisionEvolutionConnection(organization.id, created.connection.id, {
      createClient: config => ({ ...createEvolutionClient({ ...config, mode: 'fake' }),
        getInstance: async () => { throw new EvolutionHttpError(401) } }),
    })).toEqual({ error: 'CONFLICT' })
    expect(await foreign.getInstance()).toMatchObject({ instanceName: created.connection.instanceName })
  } finally {
    restoreEnvironment('EVOLUTION_CONTROL_REAL_ENABLED', controlFlag)
  }
})
