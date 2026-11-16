import { expect, test } from 'vitest'
import { evolutionNumberPreviewInput, evolutionNumberVerificationInput } from '../packages/contracts/src/index'

test('prévia aceita até 200 valores, mas consulta exige E.164, confirmação e até dez números', () => {
  expect(evolutionNumberPreviewInput.parse({ phones: ['inválido', '+5567999999999'] }).phones).toHaveLength(2)
  expect(evolutionNumberPreviewInput.safeParse({ phones: Array(201).fill('123') }).success).toBe(false)
  for (const body of [{ phones: ['+5567999999999'] }, { phones: ['123'], confirm: true },
    { phones: Array(11).fill('+5567999999999'), confirm: true },
    { phones: ['+5567999999999'], confirm: true, instanceName: 'external' }]) {
    expect(evolutionNumberVerificationInput.safeParse(body).success).toBe(false)
  }
  expect(evolutionNumberVerificationInput.parse({ phones: ['+5567999999999'], confirm: true })).toHaveProperty('confirm', true)
})
