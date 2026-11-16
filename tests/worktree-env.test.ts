import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { worktreeSettings } from '../scripts/worktree-env.mjs'

describe('isolamento local', () => {
  it('atribui bancos, namespaces e portas distintos a frentes distintas', () => {
    const first = worktreeSettings('m01-integration')
    const second = worktreeSettings('m01-admin-ui')
    expect(first.MONGO_DATABASE).not.toBe(second.MONGO_DATABASE)
    expect(first.REDIS_PREFIX).not.toBe(second.REDIS_PREFIX)
    expect(first.API_PORT).not.toBe(second.API_PORT)
  })

  it('rejeita identificadores inseguros', () => {
    expect(() => worktreeSettings('../prod')).toThrow()
  })

  it('gera e acrescenta credencial Evolution sem expor nem substituir segredos locais', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zingara-worktree-env-'))
    try {
      mkdirSync(join(directory, 'scripts'))
      const script = join(directory, 'scripts/worktree-env.mjs')
      copyFileSync('scripts/worktree-env.mjs', script)
      const { createEnv } = await import(pathToFileURL(script).href)
      const generated = createEnv('m10-test')
      expect(Buffer.from(generated.MONGO_REPLICA_KEY, 'base64')).toHaveLength(32)
      expect(new URL(generated.MONGODB_URI).searchParams.get('replicaSet')).toBe('rs0')
      expect(new URL(generated.MONGODB_URI).searchParams.get('directConnection')).toBe('true')
      expect(Buffer.from(generated.EVOLUTION_CREDENTIAL_KEY, 'base64')).toHaveLength(32)
      expect(generated.EVOLUTION_MODE).toBe('fake')
      expect(generated.EVOLUTION_CONTROL_REAL_ENABLED).toBe('0')
      expect(generated.EVOLUTION_REAL_ENABLED).toBe('0')
      expect(generated.EVOLUTION_REAL_SEND_ENABLED).toBe('0')
      expect(readFileSync(join(directory, '.env'), 'utf8')).not.toContain('UAZAPI_')

      const old = 'UAZAPI_CREDENTIAL_KEY=historical-only\nJWT_SECRET=preserved\n'
      writeFileSync(join(directory, '.env'), old)
      const updated = createEnv('m10-test')
      const saved = readFileSync(join(directory, '.env'), 'utf8')
      expect(saved).toContain(old)
      expect(updated.JWT_SECRET).toBe('preserved')
      expect(Buffer.from(updated.MONGO_REPLICA_KEY, 'base64')).toHaveLength(32)
      expect(Buffer.from(updated.EVOLUTION_CREDENTIAL_KEY, 'base64')).toHaveLength(32)
      expect(updated.EVOLUTION_MODE).toBe('fake')
      expect(updated.EVOLUTION_CONTROL_REAL_ENABLED).toBe('0')
      expect(updated.EVOLUTION_REAL_ENABLED).toBe('0')
      expect(updated.EVOLUTION_REAL_SEND_ENABLED).toBe('0')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('migra URI Mongo legada preservando credenciais, banco e chave do replica set', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zingara-worktree-env-migration-'))
    try {
      mkdirSync(join(directory, 'scripts'))
      const script = join(directory, 'scripts/worktree-env.mjs')
      copyFileSync('scripts/worktree-env.mjs', script)
      const { createEnv } = await import(pathToFileURL(script).href)
      const replicaKey = Buffer.alloc(32, 7).toString('base64')
      writeFileSync(join(directory, '.env'), [
        'MONGODB_URI=mongodb://legacy-user:legacy-password@127.0.0.1:27017/legacy_database?authSource=admin',
        `MONGO_REPLICA_KEY=${replicaKey}`,
        'JWT_SECRET=preserved',
        '',
      ].join('\n'))

      const migrated = createEnv('m10-test')
      const uri = new URL(migrated.MONGODB_URI)
      expect(uri.username).toBe('legacy-user')
      expect(uri.password).toBe('legacy-password')
      expect(uri.pathname).toBe('/legacy_database')
      expect(uri.searchParams.get('authSource')).toBe('admin')
      expect(uri.searchParams.get('replicaSet')).toBe('rs0')
      expect(uri.searchParams.get('directConnection')).toBe('true')
      expect(migrated.MONGO_REPLICA_KEY).toBe(replicaKey)
      expect(migrated.JWT_SECRET).toBe('preserved')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
