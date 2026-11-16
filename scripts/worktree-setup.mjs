import { spawnSync } from 'node:child_process'
import { createEnv, envPath } from './worktree-env.mjs'

const id = process.argv.indexOf('--id') >= 0 ? process.argv[process.argv.indexOf('--id') + 1] : undefined
const env = createEnv(id)
const result = spawnSync('pnpm', ['install', '--frozen-lockfile'], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Ambiente preparado: ${envPath()} (admin ${env.ADMIN_PORT}, convite ${env.INVITE_PORT}, API ${env.API_PORT})`)
