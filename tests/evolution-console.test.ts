import { describe, expect, test } from 'vitest'
import { canActivateEvolutionInstance, canPairEvolutionInstance, evolutionQrActionLabel, evolutionQrImageSrc, linkableEvolutionInstances, type EvolutionInventoryItem } from '../apps/admin/app/utils/evolution-console'

describe('console Evolution', () => {
  test('somente instância Zingara protegida e com canal conhecido oferece vínculo', () => {
    const item = (instanceName: string, channel: EvolutionInventoryItem['channel'], ownership: EvolutionInventoryItem['ownership']): EvolutionInventoryItem =>
      ({ instanceName, channel, ownership, state: 'connected' })
    expect(linkableEvolutionInstances([
      item('other-app', 'baileys', 'protegida'),
      item('zingara-123456', 'unknown', 'protegida'),
      item('zingara-123456', 'baileys', 'propria'),
      item('zingara-abcdef', 'cloud', 'protegida'),
    ])).toEqual([item('zingara-abcdef', 'cloud', 'protegida')])
  })

  test('QR base64 PNG sem prefixo vira imagem; texto inválido não vira data URL', () => {
    const raw = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
    expect(evolutionQrImageSrc(raw)).toBe(`data:image/png;base64,${raw}`)
    expect(evolutionQrImageSrc(`data:image/png;base64,${raw}`)).toBe(`data:image/png;base64,${raw}`)
    expect(evolutionQrImageSrc('fake-qr')).toBe('')
  })

  test('ativa pelo provisionamento local e permite renovar QR enquanto aguarda pareamento', () => {
    const instance: EvolutionInventoryItem = { instanceName: 'zingara-123456', channel: 'baileys', state: 'disconnected',
      localState: 'ready', ownership: 'propria', connectionId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
    expect(canActivateEvolutionInstance(instance)).toBe(true)
    expect(canPairEvolutionInstance(instance)).toBe(true)
    expect(canPairEvolutionInstance(instance, 'connecting')).toBe(true)
    expect(canPairEvolutionInstance(instance, 'connected')).toBe(false)
    expect(canActivateEvolutionInstance({ ...instance, localState: 'pending' })).toBe(false)
    expect(canPairEvolutionInstance({ ...instance, ownership: 'protegida' })).toBe(false)
  })

  test('explica no botão quando o QR inicia, reaparece ou é renovado', () => {
    expect(evolutionQrActionLabel('disconnected', false)).toBe('Iniciar pareamento por QR (mostrar QR)')
    expect(evolutionQrActionLabel('connecting', false)).toBe('Mostrar ou renovar QR de pareamento')
    expect(evolutionQrActionLabel('connecting', true)).toBe('Renovar QR de pareamento')
  })
})
