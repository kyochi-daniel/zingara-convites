import { describe, expect, it } from 'vitest'
import { defaultTemplate, eventTemplateValues, renderEventMessage, templateInput } from '../packages/contracts/src/index'

const event = { name: 'Celebração', location: 'Jardim', startsAt: '2027-01-15T22:00:00.000Z',
  rsvpDeadline: '2027-01-10T03:59:00.000Z', timeZone: 'America/Campo_Grande' }

describe('mensagem do evento', () => {
  it('aceita mensagem separada da arte e versões antigas sem mensagem', () => {
    const message = 'Olá {{convidado.nome}}, confirme até {{evento.prazo_confirmacao}} ({{evento.fuso}}): {{convite.link}}'
    expect(templateInput.parse({ ...defaultTemplate, message }).message).toBe(message)
    const { message: _message, ...legacy } = defaultTemplate
    expect(templateInput.safeParse(legacy).success).toBe(true)
    expect(renderEventMessage(legacy, { ...eventTemplateValues(event), 'convidado.nome': 'Ana', 'convite.link': 'https://example.test/i/individual' }))
      .toContain('https://example.test/i/individual')
  })

  it.each(['', ' '.repeat(10), 'x'.repeat(3001), '<img src=x onerror=alert(1)>', '{{evento.segredo}}', '{{evento.nome}', 'texto }}', 'texto\u0000'])('rejeita mensagem inválida: %j', message => {
    expect(templateInput.safeParse({ ...defaultTemplate, message }).success).toBe(false)
  })

  it('renderiza datas, horário e prazo em linguagem local sem UTC', () => {
    expect(eventTemplateValues(event)).toEqual({
      'evento.nome': 'Celebração', 'evento.local': 'Jardim',
      'evento.data': '15 de janeiro de 2027', 'evento.horario': '18:00',
      'evento.fuso': 'Horário de Ponta Porã',
      'evento.prazo_confirmacao': '9 de janeiro de 2027, às 23:59',
    })
    expect(eventTemplateValues({ ...event, timeZone: 'America/Sao_Paulo' }))
      .toMatchObject({ 'evento.horario': '19:00', 'evento.fuso': 'Horário de Brasília',
        'evento.prazo_confirmacao': '10 de janeiro de 2027, às 00:59' })
  })

  it('considera o fuso do instante, inclusive horário de verão', () => {
    expect(eventTemplateValues({ ...event, startsAt: '2027-07-15T22:00:00.000Z', timeZone: 'Europe/Lisbon' }))
      .toMatchObject({ 'evento.horario': '23:00', 'evento.fuso': 'Horário de Lisboa',
        'evento.prazo_confirmacao': '10 de janeiro de 2027, às 03:59' })
  })

  it('neutraliza delimitadores nos dados e não expande tokens recursivamente', () => {
    const name = '<img src=x onerror=alert(1)> *Ana* _Silva_ ~x~ `code`\n{{convite.link}}'
    const link = 'https://example.test/i/token_with-dashes'
    expect(renderEventMessage({ message: '*Olá* {{convidado.nome}}\n{{convite.link}}' }, { 'convidado.nome': name, 'convite.link': link }))
      .toBe(`*Olá* <img src=x onerror=alert(1)> ＊Ana＊ ＿Silva＿ ～x～ ｀code｀ {{convite.link}}\n${link}`)
  })

  it.each(['javascript:alert(1)', 'https://user:password@example.test/i/link', 'https://example.test/i/link\n*texto*'])('rejeita link inseguro sem expor seu valor: %s', link => {
    expect(() => renderEventMessage({ message: '{{convite.link}}' }, { 'convite.link': link }))
      .toThrow('Link de convite inválido')
  })
})
