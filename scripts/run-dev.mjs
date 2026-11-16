import { spawnSync } from 'node:child_process'

const result = spawnSync('pnpm', ['exec', 'turbo', 'dev', '--ui=tui'], { stdio: 'inherit', env: process.env })
process.exit(result.status ?? 1)
