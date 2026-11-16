import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('valida chaves de produção sem exibir segredos', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zingara-env-'))
  try {
    const file = join(directory, 'prod.env')
    const secrets = Array.from({ length: 4 }, () => randomBytes(32).toString('hex'))
    const keys = Array.from({ length: 3 }, () => randomBytes(32).toString('base64'))
    const values = [
      'MONGO_USER=zingara', `MONGO_PASSWORD=${secrets[0]}`, 'MONGO_DATABASE=zingara',
      `MONGO_REPLICA_KEY=${secrets[1]}`, `REDIS_PASSWORD=${secrets[2]}`, `JWT_SECRET=${secrets[3]}`,
      `INVITE_LINK_KEY=${keys[0]}`, `EVOLUTION_CREDENTIAL_KEY=${keys[1]}`, `ARTWORK_SIGNING_KEY=${keys[2]}`,
      'ADMIN_ORIGIN=https://admin.example.invalid', 'INVITE_ORIGIN=https://invite.example.invalid',
      'TRUSTED_PROXY_IPS=172.20.0.4',
    ]
    writeFileSync(file, values.join('\n'))
    const run = () => spawnSync(process.execPath, ['scripts/check-prod-env.mjs'], {
      cwd: process.cwd(), env: { ...process.env, PROD_ENV_FILE: file }, encoding: 'utf8',
    })
    expect(run().status).toBe(0)
    writeFileSync(file, [...values, 'OPENROUTER_API_KEY=invalid key'].join('\n'))
    expect(run().stderr).toContain('OPENROUTER_API_KEY')
    writeFileSync(file, [...values, 'OPENROUTER_API_KEY=sk-or-v1-test-value-without-space', 'OPENROUTER_MODEL=bad model'].join('\n'))
    expect(run().stderr).toContain('OPENROUTER_MODEL')
    writeFileSync(file, [...values, 'EVOLUTION_CONTROL_REAL_ENABLED=1'].join('\n'))
    expect(run().stderr).toContain('EVOLUTION_BASE_URL')
    writeFileSync(file, [...values, 'EVOLUTION_BASE_URL=https://evolution.example.invalid', 'EVOLUTION_CONTROL_REAL_ENABLED=1'].join('\n'))
    expect(run().status).toBe(0)
    writeFileSync(file, [...values, 'EVOLUTION_BASE_URL=https://evolution.example.invalid', 'EVOLUTION_CONTROL_REAL_ENABLED=true'].join('\n'))
    expect(run().stderr).toContain('EVOLUTION_CONTROL_REAL_ENABLED')
    writeFileSync(file, values.map(line => line.startsWith('EVOLUTION_CREDENTIAL_KEY=') ? 'EVOLUTION_CREDENTIAL_KEY=invalid' : line).join('\n'))
    expect(run().stderr).toContain('EVOLUTION_CREDENTIAL_KEY')
    const evolutionKey = randomBytes(32).toString('hex')
    const evolution = [
      ...values, 'EVOLUTION_BASE_URL=https://evolution.example.invalid',
      `EVOLUTION_API_KEY=${evolutionKey}`, 'EVOLUTION_MODE=real',
      'EVOLUTION_REAL_ENABLED=1', 'EVOLUTION_REAL_SEND_ENABLED=1',
    ]
    writeFileSync(file, evolution.join('\n'))
    expect(run().status).toBe(0)
    for (const line of [
      'EVOLUTION_BASE_URL=http://evolution.example.invalid',
      'EVOLUTION_BASE_URL=https://evolution.example.invalid/instance',
      'EVOLUTION_BASE_URL=https://evolution.example.invalid?token=bad',
      'EVOLUTION_API_KEY=',
      'EVOLUTION_MODE=preview',
      'EVOLUTION_REAL_ENABLED=true',
      'EVOLUTION_REAL_SEND_ENABLED=true',
    ]) {
      const name = line.split('=')[0]
      writeFileSync(file, evolution.map(value => value.startsWith(`${name}=`) ? line : value).join('\n'))
      const invalid = run()
      expect(invalid.status).toBe(1)
      expect(invalid.stderr).toContain(name)
      expect(invalid.stderr).not.toContain(evolutionKey)
    }
    writeFileSync(file, evolution.filter(line => !line.startsWith('EVOLUTION_BASE_URL=')).join('\n'))
    expect(run().stderr).toContain('EVOLUTION_BASE_URL')
    writeFileSync(file, evolution.filter(line => !line.startsWith('EVOLUTION_API_KEY=')).join('\n'))
    expect(run().stderr).toContain('EVOLUTION_API_KEY')
    writeFileSync(file, values.map(line => line.startsWith('INVITE_LINK_KEY=') ? 'INVITE_LINK_KEY=invalid' : line).join('\n'))
    const invalid = run()
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('INVITE_LINK_KEY')
    for (const secret of secrets) expect(invalid.stderr).not.toContain(secret)
    for (const key of keys) expect(invalid.stderr).not.toContain(key)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

it('restringe a chave global Evolution à API no Compose', () => {
  const compose = readFileSync('infra/compose.prod.yml', 'utf8')
  const services = Object.fromEntries([...compose.matchAll(/^  (api|admin|invite|worker):\n([\s\S]*?)(?=^  [\w-]+:|^volumes:)/gm)]
    .map(([, name, body]) => [name, body]))
  expect(services.api).toContain('EVOLUTION_API_KEY:')
  expect(services.api).toContain('OPENROUTER_API_KEY:')
  expect(services.api).toContain('EVOLUTION_CONTROL_REAL_ENABLED:')
  expect(services.api).toContain('EVOLUTION_CREDENTIAL_KEY:')
  expect(services.worker).toContain('EVOLUTION_BASE_URL:')
  expect(services.worker).toContain('EVOLUTION_CREDENTIAL_KEY:')
  expect(compose).not.toContain('UAZAPI_')
  for (const name of ['admin', 'invite', 'worker']) {
    expect(services[name]).not.toContain('EVOLUTION_API_KEY:')
    expect(services[name]).not.toContain('OPENROUTER_API_KEY:')
    expect(services[name]).not.toContain('EVOLUTION_CONTROL_REAL_ENABLED:')
  }
  for (const name of ['admin', 'invite']) expect(services[name]).not.toContain('EVOLUTION_BASE_URL:')
})
