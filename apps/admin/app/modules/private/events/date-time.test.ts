import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_TIME_ZONE, EVENT_TIME_ZONES, eventDateLabel, eventDateOffset, eventDeadlineLabel, localDateTime } from './date-time'

describe('event date-time helpers', () => {
  it('offers only the approved Brazilian time zones and defaults to Campo Grande', () => {
    expect(DEFAULT_EVENT_TIME_ZONE).toBe('America/Campo_Grande')
    expect(EVENT_TIME_ZONES).toEqual([
      { value: 'America/Campo_Grande', label: 'Ponta Porã' },
      { value: 'America/Sao_Paulo', label: 'Brasília' },
    ])
  })

  it('converts an instant to the local form used by event inputs', () => {
    expect(localDateTime('2026-01-15T14:30:00.000Z', 'America/Campo_Grande'))
      .toBe('2026-01-15T10:30')
  })

  it('adds the unique IANA offset to a local event time', () => {
    expect(eventDateOffset('2026-01-15T10:30', 'America/Campo_Grande'))
      .toBe('2026-01-15T10:30:00-04:00')
  })

  it('formats artwork dates exactly like the public invitation', () => {
    expect(eventDateLabel('2027-01-15T22:00:00.000Z', 'America/Campo_Grande'))
      .toBe('15 de janeiro de 2027, às 18:00')
    expect(eventDeadlineLabel('2027-01-10T03:59:00.000Z', 'America/Campo_Grande'))
      .toBe('9 de janeiro de 2027, às 23:59')
  })

  it('accepts an explicit offset only when it matches the selected time zone', () => {
    expect(eventDateOffset('2026-01-15T10:30:00-04:00', 'America/Campo_Grande'))
      .toBe('2026-01-15T10:30:00-04:00')
    expect(() => eventDateOffset('2026-01-15T10:30:00Z', 'America/Campo_Grande'))
      .toThrow('O offset informado não corresponde ao fuso IANA escolhido.')
  })

  it('rejects nonexistent and ambiguous local times', () => {
    expect(() => eventDateOffset('2026-03-08T02:30', 'America/New_York'))
      .toThrow('Esse horário local não existe neste fuso. Escolha outro horário.')
    expect(() => eventDateOffset('2026-11-01T01:30', 'America/New_York'))
      .toThrow('Esse horário local é ambíguo pela mudança de horário do fuso.')
  })
})
