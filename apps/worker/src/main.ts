import { startDeliveryRuntime } from './runtime.ts'

const runtime = await startDeliveryRuntime().catch(() => {
  console.error('Falha ao iniciar worker de envios')
  process.exit(1)
})
let closing = false
async function stop() {
  if (closing) return
  closing = true
  try { await runtime.close(); process.exitCode = 0 }
  catch { process.exitCode = 1 }
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })
