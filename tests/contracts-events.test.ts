import { expect, test } from 'vitest'
import { eventRevisionInput } from '../packages/contracts/src/index'

test('revisão publicada aceita prazo opcional e preserva payload anterior', () => {
  expect(eventRevisionInput.parse({
    expectedRevision: 2,
    changes: { rsvpDeadline: '2026-10-29T16:00:00-04:00' },
  }).changes.rsvpDeadline).toBe('2026-10-29T16:00:00-04:00')

  expect(eventRevisionInput.parse({
    expectedRevision: 2,
    changes: { location: 'Rua Exemplo, 123' },
  }).changes).not.toHaveProperty('rsvpDeadline')
})
