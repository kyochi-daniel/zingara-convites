import { describe, expect, it } from 'vitest'
import { evolutionInstallationInput, evolutionBindInput } from '../packages/contracts/src/index'
import { validateEvolutionInstallationOrigin } from '../packages/integrations/src/evolution'

describe('contratos M11 Evolution', () => {
  it('accepts installation input but never changes the secret', () => {
    expect(evolutionInstallationInput.parse({ baseUrl: 'https://evolution.example', adminApiKey: ' secret ' }).adminApiKey).toBe(' secret ')
    expect(evolutionInstallationInput.safeParse({ baseUrl: 'https://evolution.example', adminApiKey: '' }).success).toBe(false)
    expect(evolutionInstallationInput.safeParse({ baseUrl: 'https://evolution.example', adminApiKey: 'secret', other: true }).success).toBe(false)
  })

  it('accepts only the configured HTTPS origin', () => {
    expect(validateEvolutionInstallationOrigin('https://evolution.example/', 'https://evolution.example')).toBe('https://evolution.example')
    for (const url of ['https://other.example', 'http://evolution.example', 'https://evolution.example/path', 'https://evolution.example.evil.test']) {
      expect(() => validateEvolutionInstallationOrigin(url, 'https://evolution.example')).toThrow()
    }
    expect(() => validateEvolutionInstallationOrigin('https://evolution.example', '')).toThrow()
  })

  it('requires explicit confirmation and exact safe name for an existing instance', () => {
    expect(evolutionBindInput.parse({ channel: 'baileys', instanceName: 'legacy-zingara', token: 'secret', confirm: true }))
      .toMatchObject({ instanceName: 'legacy-zingara', confirm: true })
    expect(evolutionBindInput.safeParse({ channel: 'baileys', instanceName: ' legacy-zingara ', token: 'secret', confirm: true }).success).toBe(false)
    expect(evolutionBindInput.safeParse({ channel: 'baileys', instanceName: 'legacy-zingara', token: 'secret' }).success).toBe(false)
    expect(evolutionBindInput.safeParse({ channel: 'cloud', instanceName: 'legacy-zingara', token: 'secret', confirm: true }).success).toBe(false)
  })
})
