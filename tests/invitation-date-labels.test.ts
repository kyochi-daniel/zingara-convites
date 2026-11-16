import { expect, test } from 'vitest'
import { eventDateLabel, eventDeadlineLabel } from '../packages/invitation-ui/date-labels'

test('data e prazo do convite respeitam o fuso e o formato público', () => {
  expect(eventDateLabel('2027-01-15T22:00:00.000Z', 'America/Campo_Grande'))
    .toBe('15 de janeiro de 2027, às 18:00')
  expect(eventDateLabel('2027-01-15T22:00:00.000Z', 'America/Sao_Paulo'))
    .toBe('15 de janeiro de 2027, às 19:00')
  expect(eventDeadlineLabel('2027-01-10T03:59:00.000Z', 'America/Campo_Grande'))
    .toBe('9 de janeiro de 2027, às 23:59')
})
