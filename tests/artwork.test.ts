import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { artworkAssetKey, signArtworkUrl, verifyArtworkSignature, renderArtworkSvg, readSignedArtwork, pruneArtworkCache } from '../packages/artwork/src/index'

const previousKey = process.env.ARTWORK_SIGNING_KEY
const previousDir = process.env.ARTWORK_DIR
afterEach(() => {
  if (previousKey === undefined) delete process.env.ARTWORK_SIGNING_KEY; else process.env.ARTWORK_SIGNING_KEY = previousKey
  if (previousDir === undefined) delete process.env.ARTWORK_DIR; else process.env.ARTWORK_DIR = previousDir
})

describe('signed artwork', () => {
  it('binds signature to invitation, version and short expiry', () => {
    process.env.ARTWORK_SIGNING_KEY = Buffer.alloc(32, 7).toString('base64')
    const id = 'a'.repeat(24)
    const asset = 'c'.repeat(16)
    const expires = Math.floor(Date.now() / 1000) + 600
    const signature = signArtworkUrl(id, 2, expires, asset)
    expect(verifyArtworkSignature(id, 2, expires, signature, asset)).toBe(true)
    expect(verifyArtworkSignature('b'.repeat(24), 2, expires, signature, asset)).toBe(false)
    expect(verifyArtworkSignature(id, 3, expires, signature, asset)).toBe(false)
    expect(verifyArtworkSignature(id, 2, expires, signature, 'd'.repeat(16))).toBe(false)
    expect(verifyArtworkSignature(id, 2, Math.floor(Date.now() / 1000) - 1, signature, asset)).toBe(false)
    expect(verifyArtworkSignature(id, 2, Math.floor(Date.now() / 1000) + 7200, signature, asset)).toBe(false)
  })

  it('changes cache key when the invitation link rotates', () => {
    expect(artworkAssetKey('https://example.com/i/one')).not.toBe(artworkAssetKey('https://example.com/i/two'))
  })

  it('escapes user text before writing SVG', () => {
    const svg = renderArtworkSvg({ title: '<script>alert(1)</script>', subtitle: 'Ana & José', body: 'Bem-vindos',
      eventDate: '24/09/2026', location: 'Campo Grande', colors: { background: '#ffffff', text: '#111111', accent: '#aa5500' },
      layout: 'editorial', font: 'serif', alignment: 'center' })
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('Ana &amp; José')
    expect(svg).not.toContain('<script>')
  })

  it('serves only matching signed files and prunes expired cache files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zingara-artwork-test-'))
    process.env.ARTWORK_DIR = dir
    process.env.ARTWORK_SIGNING_KEY = Buffer.alloc(32, 9).toString('base64')
    try {
      const id = 'a'.repeat(24)
      const asset = 'c'.repeat(16)
      const file = join(dir, `${id}-1-${asset}-v2.webp`)
      await writeFile(file, Buffer.from('webp-test'))
      const expires = Math.floor(Date.now() / 1000) + 300
      const signature = signArtworkUrl(id, 1, expires, asset)
      expect(await readSignedArtwork(id, 1, expires, signature, asset)).toEqual(Buffer.from('webp-test'))
      expect(await readSignedArtwork(id, 1, expires, signature, 'd'.repeat(16))).toBeNull()
      await utimes(file, new Date(0), new Date(0))
      expect(await pruneArtworkCache()).toBe(1)
      expect(await readSignedArtwork(id, 1, expires, signature, asset)).toBeNull()
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
