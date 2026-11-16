export { eventDateLabel, eventDeadlineLabel } from '../../../../../../packages/invitation-ui/date-labels'

export const DEFAULT_EVENT_TIME_ZONE = 'America/Campo_Grande'

export const EVENT_TIME_ZONES = [
  { value: 'America/Campo_Grande', label: 'Ponta Porã' },
  { value: 'America/Sao_Paulo', label: 'Brasília' },
] as const

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  return Object.fromEntries(parts
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value])) as Record<string, string>
}

export function localDateTime(instant: string, timeZone: string) {
  const parts = zonedParts(new Date(instant), timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function eventDateOffset(value: string, timeZone: string) {
  const explicit = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  if (explicit) {
    const instant = new Date(value)
    if (Number.isNaN(instant.getTime()) || localDateTime(instant.toISOString(), timeZone) !== value.slice(0, 16)) {
      throw new Error('O offset informado não corresponde ao fuso IANA escolhido.')
    }
    return value
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Informe data e hora locais no formato AAAA-MM-DDTHH:mm.')
  const [, year, month, day, hour, minute] = match
  const naive = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const expected = `${year}-${month}-${day}T${hour}:${minute}`
  if (localDateTime(new Date(naive).toISOString(), 'UTC') !== expected) throw new Error('Data e hora inválidas.')

  const offsets = new Set<number>()
  for (let step = -12; step <= 12; step++) {
    const sampled = naive + step * 3_600_000
    const parts = zonedParts(new Date(sampled), timeZone)
    offsets.add(Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ) - sampled)
  }
  const matches = [...offsets]
    .map(offset => naive - offset)
    .filter(candidate => localDateTime(new Date(candidate).toISOString(), timeZone) === expected)
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? 'Esse horário local é ambíguo pela mudança de horário do fuso.'
      : 'Esse horário local não existe neste fuso. Escolha outro horário.')
  }

  const offsetMinutes = Math.round((naive - matches[0]!) / 60_000)
  const sign = offsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(offsetMinutes)
  return `${expected}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}
