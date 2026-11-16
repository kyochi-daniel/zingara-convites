import { Queue, Worker } from 'bullmq'
import { prepareInvitationArtwork, pruneArtworkCache } from '@zingara/artwork'
import { evaluateAutomationDelivery, planDueRules } from '@zingara/automations'
import { listDispatchableDeliveryIds, listPendingWebhookIds, listReconcilableDeliveryIds,
  processDelivery, processWebhookInbox, reconcileUncertainDelivery } from '@zingara/core'
import { connectDatabase } from '@zingara/database'
import { deliveryJobOptions, scanDeliveryOutbox, scanIdOutbox } from './outbox.ts'

const QUEUE_NAME = 'zingara-delivery'
const SCAN_INTERVAL_MS = 5000

function redisConnection() {
  const raw = process.env.REDIS_URL
  if (!raw) {
    const host = process.env.REDIS_HOST
    const port = Number(process.env.REDIS_PORT || 6379)
    if (!host || !/^[a-z0-9.-]{1,253}$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Configuração Redis inválida')
    return { host, port, password: process.env.REDIS_PASSWORD, connectTimeout: 5000, maxRetriesPerRequest: null }
  }
  const url = new URL(raw)
  if (!['redis:', 'rediss:'].includes(url.protocol) || url.search || url.hash || (url.pathname && !/^\/\d+$/.test(url.pathname))) throw new Error('REDIS_URL inválida')
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 5000,
    maxRetriesPerRequest: null,
  }
}

export async function startDeliveryRuntime(): Promise<{ close(): Promise<void> }> {
  const connection = redisConnection()
  const mongo = await connectDatabase()
  const prefix = process.env.REDIS_PREFIX?.replace(/:$/, '') || 'zingara'
  if (!/^[a-z0-9:_-]{1,100}$/i.test(prefix)) throw new Error('REDIS_PREFIX inválido')
  const queue = new Queue<{ id: string }>(QUEUE_NAME, {
    connection,
    prefix,
    defaultJobOptions: deliveryJobOptions,
  })
  const worker = new Worker<{ id: string }>(QUEUE_NAME, async job => {
    if (job.name === 'deliver') await processDelivery(job.data.id,
      { renderMedia: prepareInvitationArtwork, evaluateAutomation: evaluateAutomationDelivery })
    else if (job.name === 'webhook') await processWebhookInbox(job.data.id)
    else if (job.name === 'reconcile') await reconcileUncertainDelivery(job.data.id)
  }, {
    connection,
    prefix,
    concurrency: 1,
    limiter: { max: 1, duration: 1000 },
  })

  let stopping = false
  let scanning = false
  let pendingScan: Promise<void> | undefined
  async function scan() {
    if (stopping || scanning) return
    scanning = true
    try {
      await planDueRules()
    } catch { console.error('Falha ao planejar automações') }
    try {
      const outcome = await scanDeliveryOutbox({
        list: listDispatchableDeliveryIds,
        enqueue: (id, jobId) => queue.add('deliver', { id }, { jobId }),
      })
      if (outcome.failed) console.error('Falha ao enfileirar envios:', outcome.failed)
    } catch { console.error('Falha ao varrer outbox de envios') }
    try {
      const outcome = await scanIdOutbox({ list: listPendingWebhookIds,
        enqueue: (id, jobId) => queue.add('webhook', { id }, { jobId }) }, 'webhook')
      if (outcome.failed) console.error('Falha ao enfileirar webhooks:', outcome.failed)
    } catch { console.error('Falha ao varrer inbox de webhooks') }
    try {
      const outcome = await scanIdOutbox({ list: listReconcilableDeliveryIds,
        enqueue: (id, jobId) => queue.add('reconcile', { id }, { jobId }) }, 'reconcile')
      if (outcome.failed) console.error('Falha ao enfileirar reconciliação:', outcome.failed)
    } catch { console.error('Falha ao varrer reconciliação') }
    scanning = false
  }
  worker.on('failed', job => { console.error('Falha no processamento do envio:', job?.id || 'desconhecido') })
  worker.on('error', () => { console.error('Falha na conexão da fila de envios') })
  queue.on('error', () => { console.error('Falha na conexão da fila de envios') })

  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()])
    await pruneArtworkCache()
    await scan()
  } catch (error) {
    await worker.close().catch(() => {})
    await queue.close().catch(() => {})
    await mongo.disconnect().catch(() => {})
    throw error
  }
  const timer = setInterval(() => { pendingScan = scan() }, SCAN_INTERVAL_MS)
  timer.unref()
  const cleanupTimer = setInterval(() => { void pruneArtworkCache().catch(() => { console.error('Falha na limpeza de artes') }) }, 6 * 60 * 60 * 1000)
  cleanupTimer.unref()
  return {
    async close() {
      stopping = true
      clearInterval(timer)
      clearInterval(cleanupTimer)
      await pendingScan
      try { await worker.close() }
      finally { await Promise.all([queue.close(), mongo.disconnect()]) }
    },
  }
}
