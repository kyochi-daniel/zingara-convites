import { describe, expect, it } from 'vitest'
import { allowWebhookProxyAttempt, publicClientIp } from '../apps/invite/server/utils/public-invitation-proxy'
import { publicApiClientIp } from '../apps/api/utils/public'

describe('IP público do convite', () => {
  it('aceita X-Forwarded-For só do proxy configurado e só com IP válido', () => {
    expect(publicClientIp('172.20.0.4', '203.0.113.9, 172.20.0.4', '172.20.0.4')).toBe('203.0.113.9')
    expect(publicClientIp('172.20.0.5', '203.0.113.9', '172.20.0.4')).toBe('172.20.0.5')
    expect(publicClientIp('172.20.0.4', 'spoofed', '172.20.0.4')).toBe('172.20.0.4')
    expect(publicClientIp('::ffff:172.20.0.4', ['203.0.113.9'], '172.20.0.4')).toBe('172.20.0.4')
    expect(publicClientIp('172.20.0.4', '198.51.100.66, 203.0.113.9', '172.20.0.4')).toBe('203.0.113.9')
    expect(publicClientIp('172.20.0.4', '198.51.100.66, 203.0.113.9, 172.20.0.6',
      '172.20.0.4,172.20.0.6')).toBe('203.0.113.9')
    expect(publicClientIp('172.20.0.4', '203.0.113.9, spoofed', '172.20.0.4')).toBe('172.20.0.4')
  })

  it('limita tentativas no proxy antes da quota persistente', () => {
    process.env.WEBHOOK_ATTEMPT_LIMIT = '2'
    const now = Date.now()
    try {
      expect(allowWebhookProxyAttempt('203.0.113.70', now)).toBe(true)
      expect(allowWebhookProxyAttempt('203.0.113.70', now)).toBe(true)
      expect(allowWebhookProxyAttempt('203.0.113.70', now)).toBe(false)
      expect(allowWebhookProxyAttempt('203.0.113.71', now)).toBe(true)
      expect(allowWebhookProxyAttempt('203.0.113.70', now + 60_000)).toBe(true)
    } finally {
      delete process.env.WEBHOOK_ATTEMPT_LIMIT
    }
  })

  it('aceita o IP sanitizado apenas pela rede interna da API', () => {
    expect(publicApiClientIp('172.20.0.8', '203.0.113.9')).toBe('203.0.113.9')
    expect(publicApiClientIp('198.51.100.2', '203.0.113.9')).toBe('198.51.100.2')
    expect(publicApiClientIp('172.20.0.8', 'spoofed')).toBe('172.20.0.8')
  })
})
