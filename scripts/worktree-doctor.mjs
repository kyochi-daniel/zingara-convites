import { createServer } from 'node:net'
import { readEnv } from './worktree-env.mjs'

const env = readEnv()
for (const key of ['API_PORT', 'ADMIN_PORT', 'INVITE_PORT', 'MONGO_PORT', 'REDIS_PORT']) {
  const free = await new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(Number(env[key]), '127.0.0.1', () => server.close(() => resolve(true)))
  })
  console.log(`${key}=${env[key]} ${free ? 'livre' : 'ocupada'}`)
}
console.log(`Banco: ${env.MONGO_DATABASE}; Redis: ${env.REDIS_PREFIX}; Compose: ${env.COMPOSE_PROJECT_NAME}`)
console.log(`Gestão: ${env.ADMIN_ORIGIN}; convite: ${env.INVITE_ORIGIN}`)
