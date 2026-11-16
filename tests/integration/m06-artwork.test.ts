import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { loadEnvFile } from 'node:process'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { defaultTemplate } from '../../packages/contracts/src/index'
import { connectDatabase, GuestModel, InvitationModel, TemplateVersionModel } from '../../packages/database/src/index'
import { artworkAssetKey, prepareInvitationArtwork, readSignedArtwork } from '../../packages/artwork/src/index'
const sharp = createRequire(new URL('../../packages/artwork/package.json', import.meta.url))('sharp')

loadEnvFile('.env')
const uri = new URL(process.env.MONGODB_URI!)
uri.pathname += `_artwork_${randomUUID().replaceAll('-', '')}`
process.env.MONGODB_URI = uri.toString()
let root: string
let uploadsRoot: string
const previousUploadsDir = process.env.UPLOADS_DIR

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'zingara-artwork-'))
  process.env.ARTWORK_DIR = root
  uploadsRoot = await mkdtemp(join(tmpdir(), 'zingara-artwork-uploads-'))
  process.env.UPLOADS_DIR = uploadsRoot
  await connectDatabase()
})

afterAll(async () => {
  const mongo = await connectDatabase()
  await mongo.connection.dropDatabase()
  await mongo.disconnect()
  await rm(root, { recursive: true, force: true })
  await rm(uploadsRoot, { recursive: true, force: true })
  if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR
  else process.env.UPLOADS_DIR = previousUploadsDir
})

test('renders a WebP from the published snapshot and invalidates art after link rotation', async () => {
  const org = 'a'.repeat(24)
  const event = 'b'.repeat(24)
  const guest = await GuestModel.create({ organizationId: org, name: 'Ana & José', phone: '+5567999999999' })
  await TemplateVersionModel.create({ organizationId: org, eventId: event, version: 1, sourceDraftRevision: 1,
    sourceEventUpdatedAt: new Date(), template: defaultTemplate,
    event: { name: 'Festa', location: 'Campo Grande', address: 'Centro', startsAt: new Date().toISOString(), timeZone: 'America/Campo_Grande' },
  })
  const invitation = await InvitationModel.create({ organizationId: org, eventId: event, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 3600_000),
    rsvpDeadline: new Date(Date.now() + 1800_000), companionLimit: 2, companionNamesRequired: false, responseStatus: 'pending' })
  const first = await prepareInvitationArtwork(invitation.id, 1, 'https://example.com/i/first')
  const firstUrl = new URL(first.url)
  const firstAsset = firstUrl.searchParams.get('asset')!
  const firstImage = await readSignedArtwork(invitation.id, 1, Number(firstUrl.searchParams.get('expires')),
    firstUrl.searchParams.get('signature')!, firstAsset)
  expect(firstImage?.toString('ascii', 0, 4)).toBe('RIFF')
  expect(firstImage?.toString('ascii', 8, 12)).toBe('WEBP')

  const second = await prepareInvitationArtwork(invitation.id, 1, 'https://example.com/i/rotated')
  expect(new URL(second.url).searchParams.get('asset')).not.toBe(firstAsset)
  expect(await readSignedArtwork(invitation.id, 1, Number(firstUrl.searchParams.get('expires')),
    firstUrl.searchParams.get('signature')!, firstAsset)).toBeNull()
})

test('serves the complete uploaded artwork unchanged when the published invitation has an image', async () => {
  const org = 'c'.repeat(24)
  const event = 'd'.repeat(24)
  const assetId = 'e'.repeat(32)
  const sourceBytes = await sharp({ create: { width: 777, height: 333, channels: 3, background: '#a54f8e' } })
    .webp({ lossless: true }).toBuffer()
  const assetDir = join(uploadsRoot, assetId)
  await mkdir(assetDir)
  await writeFile(join(assetDir, 'metadata.json'), JSON.stringify({ id: assetId, organizationId: org }))
  await writeFile(join(assetDir, 'image.webp'), sourceBytes)
  const guest = await GuestModel.create({ organizationId: org, name: 'Convidada', phone: '+5567999999998' })
  await TemplateVersionModel.create({ organizationId: org, eventId: event, version: 1, sourceDraftRevision: 1,
    sourceEventUpdatedAt: new Date(), template: { ...defaultTemplate, imageAssetId: assetId },
    event: { name: 'Festa', location: 'Centro', address: 'Rua', startsAt: new Date().toISOString(), timeZone: 'America/Campo_Grande' },
  })
  const invitation = await InvitationModel.create({ organizationId: org, eventId: event, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 3600_000),
    rsvpDeadline: new Date(Date.now() + 1800_000), companionLimit: 0, companionNamesRequired: false, responseStatus: 'pending' })

  const link = 'https://example.com/i/complete-art'
  const legacyCache = join(root, `${invitation.id}-1-${artworkAssetKey(link)}.webp`)
  await writeFile(legacyCache, Buffer.from('previously composed image'))
  const signed = await prepareInvitationArtwork(invitation.id, 1, link)
  await expect(readFile(legacyCache)).rejects.toThrow()
  const signedUrl = new URL(signed.url)
  const servedBytes = await readSignedArtwork(invitation.id, 1, Number(signedUrl.searchParams.get('expires')),
    signedUrl.searchParams.get('signature')!, signedUrl.searchParams.get('asset')!)

  expect(servedBytes).toEqual(sourceBytes)
  await expect(sharp(servedBytes!).metadata()).resolves.toMatchObject({ width: 777, height: 333, format: 'webp' })
})

test('fails closed when the published template references a missing image asset', async () => {
  const org = 'f'.repeat(24)
  const event = '1'.repeat(24)
  const guest = await GuestModel.create({ organizationId: org, name: 'Convidada', phone: '+5567999999997' })
  await TemplateVersionModel.create({ organizationId: org, eventId: event, version: 1, sourceDraftRevision: 1,
    sourceEventUpdatedAt: new Date(), template: { ...defaultTemplate, imageAssetId: '2'.repeat(32) },
    event: { name: 'Festa', location: 'Centro', address: 'Rua', startsAt: new Date().toISOString(), timeZone: 'America/Campo_Grande' },
  })
  const invitation = await InvitationModel.create({ organizationId: org, eventId: event, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 3600_000),
    rsvpDeadline: new Date(Date.now() + 1800_000), companionLimit: 0, companionNamesRequired: false, responseStatus: 'pending' })

  await expect(prepareInvitationArtwork(invitation.id, 1, 'https://example.com/i/missing-art'))
    .rejects.toThrow('Arte do convite indisponível')
})

test('keeps the generated canvas artwork when the template has no image', async () => {
  const org = '3'.repeat(24)
  const event = '4'.repeat(24)
  const guest = await GuestModel.create({ organizationId: org, name: 'Convidada', phone: '+5567999999996' })
  await TemplateVersionModel.create({ organizationId: org, eventId: event, version: 1, sourceDraftRevision: 1,
    sourceEventUpdatedAt: new Date(), template: defaultTemplate,
    event: { name: 'Festa', location: 'Centro', address: 'Rua', startsAt: new Date().toISOString(), timeZone: 'America/Campo_Grande' },
  })
  const invitation = await InvitationModel.create({ organizationId: org, eventId: event, guestId: guest.id,
    templateVersion: 1, secretHash: randomUUID(), secretCiphertext: 'test', expiresAt: new Date(Date.now() + 3600_000),
    rsvpDeadline: new Date(Date.now() + 1800_000), companionLimit: 0, companionNamesRequired: false, responseStatus: 'pending' })

  const signed = await prepareInvitationArtwork(invitation.id, 1, 'https://example.com/i/no-art')
  const signedUrl = new URL(signed.url)
  const bytes = await readSignedArtwork(invitation.id, 1, Number(signedUrl.searchParams.get('expires')),
    signedUrl.searchParams.get('signature')!, signedUrl.searchParams.get('asset')!)

  expect(bytes?.toString('ascii', 0, 4)).toBe('RIFF')
  await expect(sharp(bytes!).metadata()).resolves.toMatchObject({ width: 1200, height: 1600, format: 'webp' })
})
