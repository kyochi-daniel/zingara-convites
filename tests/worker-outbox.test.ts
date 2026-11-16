import { describe, expect, it } from 'vitest'
import { deliveryJobId, deliveryJobOptions, scanDeliveryOutbox } from '../apps/worker/src/outbox'

describe('delivery outbox recovery', () => {
  it('releases finished queue IDs so Mongo can schedule a later retry', () => {
    expect(deliveryJobOptions).toEqual({ attempts: 1, removeOnComplete: true, removeOnFail: true })
  })
  it('uses stable job IDs and retries a lost enqueue on the next scan', async () => {
    const ids = ['a'.repeat(24), 'b'.repeat(24)]
    const submitted: string[] = []
    let failOnce = true
    const deps = {
      list: async () => ids,
      enqueue: async (id: string, jobId: string) => {
        expect(jobId).toBe(deliveryJobId(id))
        if (id === ids[1] && failOnce) { failOnce = false; throw new Error('redis unavailable') }
        submitted.push(id)
      },
    }
    expect(await scanDeliveryOutbox(deps)).toEqual({ enqueued: 1, failed: 1 })
    expect(await scanDeliveryOutbox(deps)).toEqual({ enqueued: 2, failed: 0 })
    expect(submitted).toEqual([ids[0], ids[0], ids[1]])
  })
})
