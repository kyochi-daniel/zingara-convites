import { expect, test } from 'vitest'
import { EvolutionInstallationModel } from '../packages/database/src/index'

test('instalação Evolution usa registro global e oculta a chave por padrão', async () => {
  const installation = new EvolutionInstallationModel({ origin: 'https://evolution.example',
    installationId: 'origin-sha256', apiKeyCiphertext: 'encrypted-only', verifiedAt: new Date() })
  await installation.validate()
  expect(installation.id).toBe('global')
  expect(EvolutionInstallationModel.schema.path('apiKeyCiphertext').options.select).toBe(false)
  expect(EvolutionInstallationModel.schema.path('origin').isRequired).toBe(true)
})
