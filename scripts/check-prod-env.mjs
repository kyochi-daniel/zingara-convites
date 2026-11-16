import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { parseEnv } from 'node:util'

const file = process.env.PROD_ENV_FILE
if (!file) throw new Error('Informe PROD_ENV_FILE')
const env = parseEnv(readFileSync(file, 'utf8'))
const errors = []
const need = (name, valid) => { if (!valid(env[name] || '')) errors.push(name) }
const safe = value => /^[A-Za-z0-9_-]{24,}$/.test(value)
const secret = value => value.length >= 32 && !/\s/.test(value)
const key = value => {
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}
const origin = value => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
  } catch { return false }
}

need('MONGO_USER', value => /^[A-Za-z0-9_-]{1,64}$/.test(value))
need('MONGO_PASSWORD', safe)
need('MONGO_DATABASE', value => !value || /^[A-Za-z0-9_-]{1,64}$/.test(value))
need('MONGO_REPLICA_KEY', value => /^[A-Za-z0-9+/=]{32,1024}$/.test(value))
need('REDIS_PASSWORD', safe)
need('JWT_SECRET', secret)
for (const name of ['INVITE_LINK_KEY', 'EVOLUTION_CREDENTIAL_KEY', 'ARTWORK_SIGNING_KEY']) need(name, key)
const secrets = ['MONGO_PASSWORD', 'MONGO_REPLICA_KEY', 'REDIS_PASSWORD', 'JWT_SECRET',
  'INVITE_LINK_KEY', 'EVOLUTION_CREDENTIAL_KEY', 'ARTWORK_SIGNING_KEY'].map(name => env[name])
if (new Set(secrets).size !== secrets.length) errors.push('SEGREDOS_DISTINTOS')
need('ADMIN_ORIGIN', origin)
need('INVITE_ORIGIN', origin)
if (env.ADMIN_ORIGIN === env.INVITE_ORIGIN) errors.push('ADMIN_ORIGIN/INVITE_ORIGIN')
need('TRUSTED_PROXY_IPS', value => value.split(',').every(ip => isIP(ip.trim()) !== 0))
for (const name of ['EVOLUTION_CONTROL_REAL_ENABLED', 'EVOLUTION_REAL_ENABLED', 'EVOLUTION_REAL_SEND_ENABLED', 'ADMIN_SUMMARY_CONSENT']) {
  if (env[name] && !['0', '1'].includes(env[name])) errors.push(name)
}
if (env.EVOLUTION_MODE && !['fake', 'real'].includes(env.EVOLUTION_MODE)) errors.push('EVOLUTION_MODE')
const evolutionEnabled = env.EVOLUTION_MODE === 'real' || env.EVOLUTION_REAL_ENABLED === '1' || env.EVOLUTION_REAL_SEND_ENABLED === '1'
if (evolutionEnabled || env.EVOLUTION_CONTROL_REAL_ENABLED === '1' || env.EVOLUTION_BASE_URL) need('EVOLUTION_BASE_URL', origin)
if (evolutionEnabled || env.EVOLUTION_API_KEY) need('EVOLUTION_API_KEY', value => !!value && !/\s/.test(value))
if (env.OPENROUTER_API_KEY) need('OPENROUTER_API_KEY', value => value.length >= 20 && !/\s/.test(value))
if (env.OPENROUTER_MODEL) need('OPENROUTER_MODEL', value => /^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(value))
if (env.ADMIN_SUMMARY_CONSENT === '1' && !/^\+[1-9]\d{7,14}$/.test(env.ADMIN_SUMMARY_PHONE || '')) errors.push('ADMIN_SUMMARY_PHONE')

if (errors.length) {
  console.error(`Configuração incompleta ou inválida: ${errors.join(', ')}`)
  process.exitCode = 1
} else console.log('Ambiente de produção válido; nenhum valor foi exibido.')
