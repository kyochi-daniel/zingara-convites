import { describe, expect, it } from 'vitest'
import {
  adminClientIp,
  adminBodyLimit,
  buildAdminProxyHeaders,
  buildAdminProxyTarget,
  resolveAdminRoute,
} from '../apps/admin/server/utils/admin-proxy-policy'
import { buildMediaTarget as buildAdminMediaTarget } from '../apps/admin/server/utils/media-proxy-policy'
import { buildMediaTarget as buildInviteMediaTarget } from '../apps/invite/server/utils/media-proxy-policy'

describe('admin proxy policy', () => {
  it('permite somente as rotas e métodos tipados de campanhas e verificação', () => {
    const base = '/admin/organizations/0123456789abcdef01234567'
    const campaigns = `${base}/events/abcdef0123456789abcdef01/campaigns`
    const campaign = `${campaigns}/abcdef0123456789abcdef02`
    const connection = `${base}/connections/evolution/abcdef0123456789abcdef03`
    for (const [path, methods] of [
      [campaigns, ['GET', 'POST']], [campaign, ['GET']], [`${campaign}/preview`, ['GET']],
      [`${campaign}/approve`, ['POST']], [`${campaign}/pause`, ['POST']], [`${campaign}/resume`, ['POST']],
      [`${campaign}/cancel`, ['POST']],
      [`${connection}/numbers-preview`, ['POST']], [`${connection}/numbers-verify`, ['POST']],
    ] as const) {
      for (const method of methods) expect(resolveAdminRoute(`/api${path}`, method)).toBe(path)
      expect(buildAdminProxyTarget('http://api.internal:4000', path)).toBe(`http://api.internal:4000${path}`)
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        if (!(methods as readonly string[]).includes(method)) expect(resolveAdminRoute(`/api${path}`, method)).toBeNull()
      }
      expect(resolveAdminRoute(`/api${path}?all=1`, methods[0])).toBeNull()
    }
    expect(resolveAdminRoute(`/api${campaigns}/foreign/approve`, 'POST')).toBeNull()
    expect(resolveAdminRoute(`/api${campaign}/send`, 'POST')).toBeNull()
    expect(resolveAdminRoute(`/api${connection}/numbers-verify/extra`, 'POST')).toBeNull()
  })
  it('amplia o limite somente para importação documental e mantém os demais tetos', () => {
    const base = '/admin/organizations/0123456789abcdef01234567'
    expect(adminBodyLimit(`${base}/guests/preview`)).toBe(360_448)
    expect(adminBodyLimit(`${base}/guests/import`)).toBe(360_448)
    expect(adminBodyLimit(`${base}/guests`)).toBe(16_384)
    expect(adminBodyLimit(`${base}/guests/preview/extra`)).toBe(16_384)
    expect(adminBodyLimit(`${base}/assets`)).toBe(5 * 1024 * 1024)
  })
  it('permite apenas leitura e envio de mensagens do assistente na organização', () => {
    const id = '0123456789abcdef01234567'
    const path = `/admin/organizations/${id}/assistant`
    for (const method of ['GET', 'POST']) {
      expect(resolveAdminRoute(`/api${path}`, method)).toBe(path)
      expect(buildAdminProxyTarget('http://api.internal:4000', path)).toBe(`http://api.internal:4000${path}`)
    }
    for (const [badPath, method] of [
      [path, 'DELETE'], [`${path}?debug=1`, 'GET'],
      [`${path}/send`, 'POST'], ['/admin/organizations/foreign/assistant', 'POST'],
    ]) expect(resolveAdminRoute(`/api${badPath}`, method)).toBeNull()
  })
  it('does not expose retired UazapiGO routes', () => {
    const base = '/admin/organizations/0123456789abcdef01234567/connections/uazapi'
    for (const [route, method] of [[base, 'GET'], [base, 'PUT'], [`${base}/status`, 'GET'], [`${base}/limits`, 'GET'], [`${base}/connect`, 'POST']]) {
      expect(resolveAdminRoute(`/api${route}`, method)).toBeNull()
      expect(buildAdminProxyTarget('http://api.internal:4000', route)).toBeNull()
    }
  })
  it('allows only owned Evolution diagnostics, templates and active selection', () => {
    const org = '0123456789abcdef01234567'
    const connection = 'abcdef0123456789abcdef01'
    const base = `/admin/organizations/${org}/connections`
    const allowed: Array<[string, string]> = [
      [`${base}/active`, 'GET'], [`${base}/active`, 'PUT'],
      [`${base}/evolution`, 'GET'], [`${base}/evolution`, 'POST'],
      [`${base}/evolution/${connection}`, 'DELETE'],
      [`${base}/evolution/${connection}/status`, 'GET'],
      [`${base}/evolution/${connection}/connect`, 'POST'],
      [`${base}/evolution/${connection}/number-check`, 'POST'],
      [`${base}/evolution/${connection}/numbers-preview`, 'POST'],
      [`${base}/evolution/${connection}/numbers-verify`, 'POST'],
      [`${base}/evolution/${connection}/templates`, 'GET'],
      [`${base}/evolution/${connection}/templates`, 'PUT'],
    ]
    for (const [path, method] of allowed) {
      expect(resolveAdminRoute(`/api${path}`, method)).toBe(path)
      expect(buildAdminProxyTarget('http://api.internal:4000', path)).toBe(`http://api.internal:4000${path}`)
    }
    for (const [path, method] of [
      [`${base}/evolution/${connection}/send`, 'POST'],
      [`${base}/evolution/${connection}/numbers-verify`, 'GET'],
      [`${base}/evolution/${connection}/numbers-verify?all=1`, 'POST'],
      [`${base}/evolution/${connection}/status`, 'POST'],
      [`${base}/evolution/${connection}/templates?all=1`, 'GET'],
      [`${base}/evolution/foreign-name/status`, 'GET'],
      [`${base}/evolution/${connection}`, 'GET'],
    ]) expect(resolveAdminRoute(`/api${path}`, method)).toBeNull()
    expect(buildAdminProxyHeaders({ origin: 'https://admin.example', csrfToken: 'csrf', cookie: 'session=x' },
      'https://admin.example', { mutating: true, csrfRequired: true, jsonRequired: false })?.get('x-csrf-token')).toBe('csrf')
    expect(buildAdminProxyHeaders({ origin: 'https://admin.example', cookie: 'session=x' },
      'https://admin.example', { mutating: true, csrfRequired: true, jsonRequired: false })).toBeNull()
  })
  it('uses a forwarded login IP only from an explicitly trusted proxy', () => {
    expect(adminClientIp('172.20.0.4', '203.0.113.9, 172.20.0.4', '172.20.0.4')).toBe('203.0.113.9')
    expect(adminClientIp('172.20.0.5', '203.0.113.9', '172.20.0.4')).toBe('172.20.0.5')
    expect(adminClientIp('172.20.0.4', 'invalid', '172.20.0.4')).toBe('172.20.0.4')
    expect(adminClientIp('172.20.0.4', '198.51.100.66, 203.0.113.9', '172.20.0.4')).toBe('203.0.113.9')
    expect(adminClientIp('172.20.0.4', '198.51.100.66, 203.0.113.9, 172.20.0.6',
      '172.20.0.4,172.20.0.6')).toBe('203.0.113.9')
    expect(adminClientIp('172.20.0.5', '198.51.100.66, 203.0.113.9',
      '172.20.0.4,172.20.0.6')).toBe('172.20.0.5')
  })
  it('allows only agreed admin methods and routes', () => {
    expect(resolveAdminRoute('/api/admin/auth/login', 'POST')).toBe('/admin/auth/login')
    expect(resolveAdminRoute('/api/admin/auth/session', 'GET')).toBe('/admin/auth/session')
    expect(resolveAdminRoute('/api/admin/auth/logout', 'POST')).toBe('/admin/auth/logout')
    expect(resolveAdminRoute('/api/admin/organizations', 'GET')).toBe('/admin/organizations')
    expect(resolveAdminRoute('/api/admin/organizations', 'POST')).toBe('/admin/organizations')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567', 'PATCH'))
      .toBe('/admin/organizations/0123456789abcdef01234567')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01', 'PATCH'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/guests?page=2&limit=50&q=ana', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/guests?page=2&limit=50&q=ana')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=100&tag=clientes', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=100&tag=clientes')
    expect(buildAdminProxyTarget('http://api.internal:4000',
      '/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=100&tag=clientes'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=100&tag=clientes')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/guests/preview', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/guests/preview')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/guests/import', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/guests/import')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/assets', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/assets')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template', 'PUT'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/publish', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/publish')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/versions/2', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/versions/2')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/link', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/link')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/rotate', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/rotate')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/revoke', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/revoke')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/revise', 'PUT'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/revise')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/cancel', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/cancel')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder', 'PUT'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/preview', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/preview')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/activate', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/activate')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=50', 'GET'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=50')
    expect(resolveAdminRoute('/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/guests/abcdef0123456789abcdef01/suppress', 'POST'))
      .toBe('/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/guests/abcdef0123456789abcdef01/suppress')
  })

  it('rejects unsupported methods, paths, ids, and encoded paths', () => {
    for (const [path, method] of [
      ['/api/admin/auth/login', 'GET'],
      ['/api/admin/auth/register', 'POST'],
      ['/api/admin/organizations', 'DELETE'],
      ['/api/admin/organizations/not-an-id', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/extra', 'GET'],
      ['/api/admin/%2e%2e/auth/login', 'POST'],
      ['/api/admin/organizations?filter=all', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events?page=1&sort=name', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/guests?page=0', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/guests?page=1&page=2', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/invalid', 'PATCH'],
      ['/api/admin/organizations/0123456789abcdef01234567/events?tag=clientes', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/guests?tag=', 'GET'],
      [`/api/admin/organizations/0123456789abcdef01234567/guests?tag=${'x'.repeat(41)}`, 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/guests/preview', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/assets', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/versions/0', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/publish', 'POST'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/versions/2', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations?status=pending', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report', 'POST'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report?include=test', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/not-an-id/link', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/DELETE', 'DELETE'],
      ['/api/admin/organizations/0123456789abcdef01234567/connections/uazapi?x=1', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/connections/uazapi/status?refresh=1', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/connections/uazapi/connect', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/connections/uazapi/limits', 'POST'],
      ['/api/admin/organizations/not-an-id/connections/uazapi', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries?status=queued', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=bad', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01&extra=1', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01', 'POST'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/revise', 'POST'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/cancel', 'PUT'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/invalid/cancel', 'POST'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/preview?x=1', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=0', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=51', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=5&limit=6', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/unknown', 'PUT'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/activate', 'GET'],
      ['/api/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/guests/not-an-id/suppress', 'POST'],
    ]) {
      expect(resolveAdminRoute(path, method)).toBeNull()
    }
  })

  it('permits only the Evolution console routes and local connection IDs', () => {
    const id = '0123456789abcdef01234567'
    for (const [path, method] of [
      ['/admin/evolution/installation', 'GET'],
      [`/admin/organizations/${id}/connections/evolution/instances`, 'GET'],
      [`/admin/organizations/${id}/connections/evolution/link`, 'POST'],
    ]) {
      expect(resolveAdminRoute(`/api${path}`, method)).toBe(path)
      expect(buildAdminProxyTarget('http://api.internal:4000', path)).toBe(`http://api.internal:4000${path}`)
    }
    for (const [path, method] of [
      ['/admin/evolution/installation', 'PUT'],
      ['/admin/evolution/installation', 'POST'],
      [`/admin/organizations/${id}/connections/evolution/instances`, 'DELETE'],
      ['/admin/evolution/instances/foreign/connect', 'POST'],
      [`/admin/organizations/${id}/connections/evolution/foreign/connect`, 'POST'],
      [`/admin/organizations/${id}/connections/evolution/link?name=foreign`, 'POST'],
    ]) expect(resolveAdminRoute(`/api${path}`, method)).toBeNull()
  })

  it('forwards only session and CSRF headers after same-origin checks', () => {
    const headers = buildAdminProxyHeaders({
      origin: 'https://admin.example',
      cookie: 'session=opaque',
      csrfToken: 'csrf-value',
      contentType: 'application/json',
      authorization: 'Bearer forged',
      'x-admin-id': 'forged',
      'x-forwarded-host': 'evil.example',
    } as Parameters<typeof buildAdminProxyHeaders>[0], 'https://admin.example', { mutating: true, csrfRequired: true })

    expect(headers?.get('origin')).toBe('https://admin.example')
    expect(headers?.get('cookie')).toBe('session=opaque')
    expect(headers?.get('x-csrf-token')).toBe('csrf-value')
    expect(headers?.get('content-type')).toBe('application/json')
    expect([...headers!.keys()].sort()).toEqual(['content-type', 'cookie', 'origin', 'x-csrf-token'])
  })

  it('rejects cross-origin mutations and mutations without CSRF', () => {
    const request = { origin: 'https://admin.example', contentType: 'application/json' }
    expect(buildAdminProxyHeaders({ ...request, origin: 'https://evil.example', csrfToken: 'x' }, 'https://admin.example', { mutating: true, csrfRequired: true }))
      .toBeNull()
    expect(buildAdminProxyHeaders(request, 'https://admin.example', { mutating: true, csrfRequired: true }))
      .toBeNull()
  })

  it('keeps login same-origin without forwarding an existing session cookie', () => {
    const headers = buildAdminProxyHeaders({
      origin: 'https://admin.example',
      contentType: 'application/json; charset=utf-8',
      cookie: 'session=old',
    }, 'https://admin.example', { mutating: true, csrfRequired: false, cookieAllowed: false })

    expect(headers?.get('origin')).toBe('https://admin.example')
    expect(headers?.get('content-type')).toBe('application/json; charset=utf-8')
    expect(headers?.has('cookie')).toBe(false)
    expect(headers?.has('x-csrf-token')).toBe(false)
  })

  it('accepts logout without a JSON body', () => {
    const headers = buildAdminProxyHeaders({ origin: 'https://admin.example', csrfToken: 'csrf', cookie: 'session=x' },
      'https://admin.example', { mutating: true, csrfRequired: true, jsonRequired: false })
    expect(headers?.get('x-csrf-token')).toBe('csrf')
    expect(headers?.has('content-type')).toBe(false)
  })

  it('accepts only allowed image types for upload', () => {
    const policy = { mutating: true, csrfRequired: true, jsonRequired: false, imageRequired: true }
    const base = { origin: 'https://admin.example', csrfToken: 'csrf', cookie: 'session=x' }
    for (const contentType of ['image/png', 'image/jpeg', 'image/webp']) {
      const headers = buildAdminProxyHeaders({ ...base, contentType }, 'https://admin.example', policy)
      expect(headers?.get('content-type')).toBe(contentType)
    }
    expect(buildAdminProxyHeaders({ ...base, contentType: 'image/svg+xml' }, 'https://admin.example', policy)).toBeNull()
    expect(buildAdminProxyHeaders({ ...base, contentType: 'application/json' }, 'https://admin.example', policy)).toBeNull()
    expect(buildAdminProxyHeaders({ ...base, contentType: 'image/png; charset=utf-8' }, 'https://admin.example', policy)).toBeNull()
  })

  it('builds targets only from a fixed API origin and approved internal route', () => {
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/auth/session'))
      .toBe('http://api.internal:4000/admin/auth/session')
    expect(buildAdminProxyTarget('javascript:alert(1)', '/admin/auth/session')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', 'https://evil.example')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/../health')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=20'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/guests?page=1&limit=20')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/auth/session?x=1')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/preview')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/assets'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/assets')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/publish'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/publish')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/versions/2'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/template/versions/2')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/versions/2')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/rotate'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations/abcdef0123456789abcdef01/rotate')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/invitations?status=pending')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/report?include=test')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/connections/uazapi/status?refresh=1')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/connections/uazapi/connect/extra')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?invitationId=abcdef0123456789abcdef01')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/deliveries/preview?extra=1')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/preview'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/pending_reminder/preview')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=50'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=50')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/jobs?limit=51')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/automations/unknown')).toBeNull()
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/revise'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/revise')
    expect(buildAdminProxyTarget('http://api.internal:4000', '/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/cancel'))
      .toBe('http://api.internal:4000/admin/organizations/0123456789abcdef01234567/events/abcdef0123456789abcdef01/cancel')
  })

  it('both public media proxies accept only opaque IDs', () => {
    const id = '0123456789abcdef0123456789abcdef'
    for (const build of [buildAdminMediaTarget, buildInviteMediaTarget]) {
      expect(build('http://api.internal:4000', id)).toBe(`http://api.internal:4000/media/${id}`)
      expect(build('http://api.internal:4000', '../health')).toBeNull()
      expect(build('http://api.internal:4000', 'zzzz')).toBeNull()
      expect(build('javascript:alert(1)', id)).toBeNull()
      expect(build('http://user:secret@api.internal:4000', id)).toBeNull()
    }
  })
})
