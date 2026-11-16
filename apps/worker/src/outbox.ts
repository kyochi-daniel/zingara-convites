export function outboxJobId(kind: 'delivery' | 'webhook' | 'reconcile', id: string): string {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new Error('ID de envio inválido')
  return `${kind}-${id.toLowerCase()}`
}
export function deliveryJobId(id: string): string { return outboxJobId('delivery', id) }

// Mongo decide retries; BullMQ must release finished IDs for a later outbox scan.
export const deliveryJobOptions = { attempts: 1, removeOnComplete: true, removeOnFail: true } as const

export async function scanIdOutbox(deps: {
  list: (limit: number) => Promise<string[]>
  enqueue: (id: string, jobId: string) => Promise<unknown>
}, kind: 'delivery' | 'webhook' | 'reconcile', limit = 100): Promise<{ enqueued: number; failed: number }> {
  const ids = await deps.list(limit)
  let enqueued = 0
  let failed = 0
  for (const id of ids) {
    try {
      await deps.enqueue(id, outboxJobId(kind, id))
      enqueued++
    } catch { failed++ }
  }
  return { enqueued, failed }
}

export async function scanDeliveryOutbox(deps: {
  list: (limit: number) => Promise<string[]>
  enqueue: (id: string, jobId: string) => Promise<unknown>
}, limit = 100) { return scanIdOutbox(deps, 'delivery', limit) }
