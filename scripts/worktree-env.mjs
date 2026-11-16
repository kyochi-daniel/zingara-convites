import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export function worktreeSettings(id) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id)) throw new Error('Identificador inválido')
  const slot = createHash('sha256').update(id).digest().readUInt16BE() % 1000
  const base = 20000 + slot * 10
  return {
    COMPOSE_PROJECT_NAME: `zingara_${id.replaceAll('-', '_')}`,
    MONGO_PORT: String(base + 3),
    REDIS_PORT: String(base + 4),
    API_PORT: String(base),
    ADMIN_PORT: String(base + 1),
    INVITE_PORT: String(base + 2),
    MONGO_DATABASE: `zingara_${id.replaceAll('-', '_')}`,
    REDIS_PREFIX: `zingara:${id}:`,
  }
}

export function envPath() { return resolve(import.meta.dirname, '../.env') }

export function readEnv() {
  if (!existsSync(envPath())) throw new Error('Execute pnpm worktree:setup primeiro')
  return Object.fromEntries(readFileSync(envPath(), 'utf8').split('\n').filter(Boolean).map(line => {
    const position = line.indexOf('=')
    return [line.slice(0, position), line.slice(position + 1)]
  }))
}

export function createEnv(id = basename(resolve(import.meta.dirname, '..')).toLowerCase().replace(/[^a-z0-9-]/g, '-')) {
  if (existsSync(envPath())) {
    const env = readEnv()
    const additions = {}
    if (!env.MONGO_REPLICA_KEY) additions.MONGO_REPLICA_KEY = randomBytes(32).toString('base64')
    if (env.MONGODB_URI) {
      const uri = new URL(env.MONGODB_URI)
      if (uri.searchParams.get('replicaSet') !== 'rs0' || uri.searchParams.get('directConnection') !== 'true') {
        uri.searchParams.set('replicaSet', 'rs0')
        uri.searchParams.set('directConnection', 'true')
        additions.MONGODB_URI = uri.toString()
      }
    }
    if (!env.ARTWORK_SIGNING_KEY) additions.ARTWORK_SIGNING_KEY = randomBytes(32).toString('base64')
    if (!env.EVOLUTION_CREDENTIAL_KEY) additions.EVOLUTION_CREDENTIAL_KEY = randomBytes(32).toString('base64')
    if (!env.EVOLUTION_MODE) additions.EVOLUTION_MODE = 'fake'
    if (!env.EVOLUTION_CONTROL_REAL_ENABLED) additions.EVOLUTION_CONTROL_REAL_ENABLED = '0'
    if (!env.EVOLUTION_REAL_ENABLED) additions.EVOLUTION_REAL_ENABLED = '0'
    if (!env.EVOLUTION_REAL_SEND_ENABLED) additions.EVOLUTION_REAL_SEND_ENABLED = '0'
    if (!env.REDIS_URL && env.REDIS_PASSWORD && env.REDIS_PORT) {
      additions.REDIS_URL = `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@127.0.0.1:${env.REDIS_PORT}`
    }
    if (Object.keys(additions).length) writeFileSync(envPath(), Object.entries(additions).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'a', mode: 0o600 })
    return { ...env, ...additions }
  }
  const settings = worktreeSettings(id)
  const secrets = {
    MONGO_USER: 'zingara',
    MONGO_PASSWORD: randomBytes(24).toString('hex'),
    MONGO_REPLICA_KEY: randomBytes(32).toString('base64'),
    REDIS_PASSWORD: randomBytes(24).toString('hex'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    INVITE_LINK_KEY: randomBytes(32).toString('base64'),
    EVOLUTION_CREDENTIAL_KEY: randomBytes(32).toString('base64'),
    ARTWORK_SIGNING_KEY: randomBytes(32).toString('base64'),
  }
  const env = { ...settings, ...secrets }
  env.MONGODB_URI = `mongodb://${env.MONGO_USER}:${env.MONGO_PASSWORD}@127.0.0.1:${env.MONGO_PORT}/${env.MONGO_DATABASE}?authSource=admin&replicaSet=rs0&directConnection=true`
  env.REDIS_URL = `redis://:${encodeURIComponent(env.REDIS_PASSWORD)}@127.0.0.1:${env.REDIS_PORT}`
  env.API_INTERNAL_URL = `http://localhost:${env.API_PORT}`
  env.ADMIN_ORIGIN = `http://${id}.admin.localhost:${env.ADMIN_PORT}`
  env.INVITE_ORIGIN = `http://${id}.invite.localhost:${env.INVITE_PORT}`
  env.JWT_ISSUER = 'zingara-local'
  env.JWT_AUDIENCE = 'zingara-admin'
  env.EVOLUTION_MODE = 'fake'
  env.EVOLUTION_CONTROL_REAL_ENABLED = '0'
  env.EVOLUTION_REAL_ENABLED = '0'
  env.EVOLUTION_REAL_SEND_ENABLED = '0'
  writeFileSync(envPath(), Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
  return env
}
