import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { defaultTemplate, eventTemplateValues, resolveTemplateText, templateInput } from '@zingara/contracts'
import { connectDatabase, GuestModel, InvitationModel, TemplateVersionModel } from '@zingara/database'
import sharp from 'sharp'

const ID = /^[a-f0-9]{24}$/i
const ASSET = /^[a-f0-9]{16}$/
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/
const MAX_TTL_SECONDS = 3600
const ARTWORK_CACHE_VERSION = 'v2'

export function artworkAssetKey(invitationLink: string): string {
  return createHash('sha256').update(invitationLink).digest('hex').slice(0, 16)
}

function artworkKey(): Buffer {
  const encoded = process.env.ARTWORK_SIGNING_KEY || ''
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('ARTWORK_SIGNING_KEY inválida')
  return key
}

function validIdentity(invitationId: string, version: number): boolean {
  return ID.test(invitationId) && Number.isSafeInteger(version) && version >= 1 && version <= 1_000_000
}

export function signArtworkUrl(invitationId: string, version: number, expires: number, asset: string): string {
  if (!validIdentity(invitationId, version) || !Number.isSafeInteger(expires) || !ASSET.test(asset)) throw new Error('Arte inválida')
  return createHmac('sha256', artworkKey()).update(`${invitationId.toLowerCase()}:${version}:${asset}:${expires}`).digest('base64url')
}

export function verifyArtworkSignature(invitationId: string, version: number, expires: number, signature: string, asset: string): boolean {
  const now = Math.floor(Date.now() / 1000)
  if (!validIdentity(invitationId, version) || !Number.isSafeInteger(expires) || expires < now || expires > now + MAX_TTL_SECONDS || !SIGNATURE.test(signature) || !ASSET.test(asset)) return false
  const supplied = Buffer.from(signature, 'base64url')
  const expected = Buffer.from(signArtworkUrl(invitationId, version, expires, asset), 'base64url')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function artworkDir(): string {
  const configured = process.env.ARTWORK_DIR
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('ARTWORK_DIR deve ser absoluto')
    return resolve(configured)
  }
  const project = process.env.COMPOSE_PROJECT_NAME
  return join(homedir(), '.local', 'share', 'zingara', 'artwork', project && /^[a-z0-9_]+$/.test(project) ? project : 'local')
}

async function storageRoot(): Promise<string> {
  const root = artworkDir()
  await mkdir(root, { recursive: true, mode: 0o700 })
  return realpath(root)
}

export async function pruneArtworkCache(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  const root = await storageRoot()
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const name of await readdir(root)) {
    if (!/^[a-f0-9]{24}-\d{1,7}-[a-f0-9]{16}(?:-v2)?\.webp(?:\.\d+\.[a-f0-9]+\.tmp)?$/.test(name)) continue
    const path = join(root, name)
    try {
      if ((await stat(path)).mtimeMs < cutoff) { await rm(path); removed++ }
    } catch { /* Another worker may remove the same file. */ }
  }
  return removed
}

function escapeXml(value: string): string {
  return [...value].filter(character => {
    const code = character.codePointAt(0)!
    return code >= 32 || code === 9 || code === 10 || code === 13
  }).join('').replace(/[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

function lines(text: string, width: number, limit: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const result: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    if (line && `${line} ${word}`.length > width) { result.push(line); line = '' }
    line = line ? `${line} ${word}` : word.slice(0, width)
    if (result.length >= limit) break
  }
  if (line && result.length < limit) result.push(line)
  if (words.join(' ').length > result.join(' ').length && result.length) result[result.length - 1] = `${result[result.length - 1]!.slice(0, width - 1)}…`
  return result
}

export type ArtworkSvgInput = {
  title: string
  subtitle: string
  body: string
  eventDate: string
  location: string
  colors: { background: string; text: string; accent: string }
  layout: 'editorial' | 'classic'
  font: 'serif' | 'sans'
  alignment: 'left' | 'center'
  hasImage?: boolean
}

export function renderArtworkSvg(input: ArtworkSvgInput): string {
  const { background, text, accent } = input.colors
  if (![background, text, accent].every(value => /^#[0-9a-fA-F]{6}$/.test(value))) throw new Error('Cores inválidas')
  const font = input.font === 'serif' ? 'Georgia, serif' : 'Arial, sans-serif'
  const anchor = input.alignment === 'center' ? 'middle' : 'start'
  const x = input.alignment === 'center' ? 600 : 110
  const top = input.hasImage ? 625 : 300
  const titleLines = lines(input.title, 24, 3)
  const subtitleLines = lines(input.subtitle, 44, 3)
  const bodyLines = lines(input.body, 58, input.hasImage ? 5 : 12)
  const write = (content: string[], start: number, step: number, size: number, weight = 'normal') => content.map((line, index) =>
    `<text x="${x}" y="${start + index * step}" fill="${text}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}">${escapeXml(line)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <rect x="0" y="${input.hasImage ? 480 : 0}" width="1200" height="${input.hasImage ? 1120 : 1600}" fill="${background}"/>
  <rect x="${input.alignment === 'center' ? 515 : 110}" y="${top - 115}" width="170" height="8" fill="${accent}"/>
  ${write(titleLines, top, 85, input.layout === 'classic' ? 72 : 78, 'bold')}
  ${write(subtitleLines, top + titleLines.length * 85 + 65, 55, 39)}
  ${write(bodyLines, top + titleLines.length * 85 + subtitleLines.length * 55 + 140, 46, 30)}
  <text x="${x}" y="1470" fill="${accent}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="31">${escapeXml(input.eventDate)}</text>
  <text x="${x}" y="1525" fill="${text}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="28">${escapeXml(input.location)}</text>
  </svg>`
}

async function readImageAsset(assetId: string, organizationId: string): Promise<Buffer | null> {
  if (!/^[a-f0-9]{32}$/.test(assetId)) return null
  const configured = process.env.UPLOADS_DIR
  if (configured && !isAbsolute(configured)) throw new Error('UPLOADS_DIR deve ser absoluto')
  const project = process.env.COMPOSE_PROJECT_NAME
  const root = configured ? resolve(configured) : join(homedir(), '.local', 'share', 'zingara', 'uploads', project && /^[a-z0-9_]+$/.test(project) ? project : 'local')
  try {
    const metadata = JSON.parse(await readFile(join(root, assetId, 'metadata.json'), 'utf8')) as { id?: string; organizationId?: string }
    if (metadata.id !== assetId || metadata.organizationId?.toLowerCase() !== organizationId.toLowerCase()) return null
    const file = join(root, assetId, 'image.webp')
    if (!(await stat(file)).isFile()) return null
    return readFile(file)
  } catch { return null }
}

async function renderArtwork(invitationId: string, templateVersion: number, invitationLink: string): Promise<Buffer> {
  await connectDatabase()
  const invitations = InvitationModel as unknown as { findById(id: string): Promise<Record<string, unknown> | null> }
  const guests = GuestModel as unknown as { findOne(filter: Record<string, unknown>): { select(fields: string): Promise<{ name: string } | null> } }
  const versions = TemplateVersionModel as unknown as { findOne(filter: Record<string, unknown>): Promise<{ template: unknown; event: unknown } | null> }
  const invitation = await invitations.findById(invitationId)
  if (!invitation || invitation.templateVersion !== templateVersion) throw new Error('Convite não encontrado')
  const [guest, version] = await Promise.all([
    guests.findOne({ _id: invitation.guestId, organizationId: invitation.organizationId }).select('name'),
    versions.findOne({ eventId: invitation.eventId, version: templateVersion, organizationId: invitation.organizationId }),
  ])
  if (!guest || !version) throw new Error('Dados do convite indisponíveis')
  const template = templateInput.parse(version.template || defaultTemplate)
  const event = version.event as { name: string; location: string; startsAt: string; timeZone: string }
  const values = { ...eventTemplateValues({ ...event, rsvpDeadline: new Date(String(invitation.rsvpDeadline)).toISOString() }),
    'convidado.nome': guest.name,
    'convite.link': invitationLink, 'convite.limite_acompanhantes': invitation.companionLimit as number }
  if (template.imageAssetId) {
    const image = await readImageAsset(template.imageAssetId, String(invitation.organizationId))
    if (!image) throw new Error('Arte do convite indisponível')
    return image
  }
  const svg = renderArtworkSvg({ title: resolveTemplateText(template.title, values), subtitle: resolveTemplateText(template.subtitle, values),
    body: resolveTemplateText(template.body, values), eventDate: `${values['evento.data']} · ${values['evento.horario']}`, location: event.location,
    colors: template.colors, layout: template.layout, font: template.font, alignment: template.alignment })
  const base = sharp({ create: { width: 1200, height: 1600, channels: 4, background: template.colors.background } })
  return base.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).webp({ quality: 82 }).toBuffer()
}

export async function prepareInvitationArtwork(invitationId: string, templateVersion: number, invitationLink: string): Promise<{ url: string; expiresAt: Date }> {
  if (!validIdentity(invitationId, templateVersion)) throw new Error('Convite inválido')
  const origin = process.env.INVITE_ORIGIN
  if (!origin) throw new Error('INVITE_ORIGIN ausente')
  const root = await storageRoot()
  const asset = artworkAssetKey(invitationLink)
  const name = `${invitationId.toLowerCase()}-${templateVersion}-${asset}-${ARTWORK_CACHE_VERSION}.webp`
  try { if (!(await stat(join(root, name))).isFile()) throw new Error('missing') }
  catch {
    const image = await renderArtwork(invitationId, templateVersion, invitationLink)
    if (image.length > 5 * 1024 * 1024) throw new Error('Arte excede limite')
    const temporary = join(root, `${name}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`)
    await writeFile(temporary, image, { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(root, name))
  }
  for (const old of await readdir(root)) {
    if (old !== name && old.startsWith(`${invitationId.toLowerCase()}-`) && /^[a-f0-9]{24}-\d{1,7}-[a-f0-9]{16}(?:-v2)?\.webp$/.test(old)) {
      await rm(join(root, old), { force: true })
    }
  }
  const expires = Math.floor(Date.now() / 1000) + 1800
  const signature = signArtworkUrl(invitationId, templateVersion, expires, asset)
  const url = new URL(`/media/invitations/${invitationId.toLowerCase()}/${templateVersion}`, origin)
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('signature', signature)
  url.searchParams.set('asset', asset)
  return { url: url.toString(), expiresAt: new Date(expires * 1000) }
}

export async function readSignedArtwork(invitationId: string, version: number, expires: number, signature: string, asset: string): Promise<Buffer | null> {
  if (!verifyArtworkSignature(invitationId, version, expires, signature, asset)) return null
  try {
    const file = join(await storageRoot(), `${invitationId.toLowerCase()}-${version}-${asset}-${ARTWORK_CACHE_VERSION}.webp`)
    const size = (await stat(file)).size
    if (size > 5 * 1024 * 1024) return null
    return await readFile(file)
  } catch { return null }
}
