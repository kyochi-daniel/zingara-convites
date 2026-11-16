export function eventDateLabel(instant: string, timeZone: string) {
  const date = new Date(instant)
  const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone }).format(date)
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone }).format(date)
  return `${day}, às ${time}`
}

export function eventDeadlineLabel(instant: string, timeZone: string) {
  return eventDateLabel(instant, timeZone)
}
