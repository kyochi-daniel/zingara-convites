import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createError } from 'h3'
import sharp from 'sharp'

export const MAX_ASSET_BYTES = 5 * 1024 * 1024
const MAX_PIXELS = 16_000_000
const MAX_EDGE = 4096
const ASSET_ID = /^[a-f0-9]{32}$/
const ORGANIZATION_ID = /^[a-f0-9]{24}$/i
const formats: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
}

function uploadsDir() {
  const configured = process.env.UPLOADS_DIR
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('UPLOADS_DIR deve ser absoluto')
    return resolve(configured)
  }
  const project = process.env.COMPOSE_PROJECT_NAME
  return join(homedir(), '.local', 'share', 'zingara', 'uploads',
    project && /^[a-z0-9_]+$/.test(project) ? project : 'local')
}

async function storageRoot() {
  const root = uploadsDir()
  await mkdir(root, { recursive: true, mode: 0o700 })
  return realpath(root)
}

function invalidImage() {
  return createError({ statusCode: 400, statusMessage: 'Imagem inválida' })
}

export async function storeAsset(organizationId: string, input: Buffer, contentType: string) {
  if (!ORGANIZATION_ID.test(organizationId)) throw createError({ statusCode: 404, statusMessage: 'Organização não encontrada' })
  if (!formats[contentType]) throw createError({ statusCode: 415, statusMessage: 'Tipo de imagem não aceito' })
  if (!input.length) throw invalidImage()
  if (input.length > MAX_ASSET_BYTES) throw createError({ statusCode: 413, statusMessage: 'Imagem muito grande' })
  let output: Buffer
  try {
    const decoder = sharp(input, { failOn: 'error', limitInputPixels: MAX_PIXELS })
    const metadata = await decoder.metadata()
    if (metadata.format !== formats[contentType] || !metadata.width || !metadata.height ||
      metadata.width > MAX_EDGE || metadata.height > MAX_EDGE ||
      metadata.width * metadata.height > MAX_PIXELS || (metadata.pages ?? 1) !== 1) throw invalidImage()
    output = await decoder.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer()
  } catch {
    throw invalidImage()
  }
  const root = await storageRoot()
  const id = randomBytes(16).toString('hex')
  const staging = await mkdtemp(join(root, '.pending-'))
  try {
    await writeFile(join(staging, 'image.webp'), output, { flag: 'wx', mode: 0o600 })
    await writeFile(join(staging, 'metadata.json'), JSON.stringify({ id, organizationId }), { flag: 'wx', mode: 0o600 })
    await rename(staging, join(root, id))
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return { id, url: `/media/${id}` }
}

async function assetMetadata(assetId: string) {
  if (!ASSET_ID.test(assetId)) return null
  const root = await storageRoot()
  try {
    const metadata = JSON.parse(await readFile(join(root, assetId, 'metadata.json'), 'utf8')) as unknown
    if (!metadata || typeof metadata !== 'object' || !('id' in metadata) || metadata.id !== assetId ||
      !('organizationId' in metadata) || typeof metadata.organizationId !== 'string' ||
      !ORGANIZATION_ID.test(metadata.organizationId)) return null
    if (!(await stat(join(root, assetId, 'image.webp'))).isFile()) return null
    return { root, organizationId: metadata.organizationId }
  } catch {
    return null
  }
}

export async function assetBelongsToOrganization(assetId: string, organizationId: string): Promise<boolean> {
  if (!ORGANIZATION_ID.test(organizationId)) return false
  const metadata = await assetMetadata(assetId)
  return metadata?.organizationId.toLowerCase() === organizationId.toLowerCase()
}

export async function readAsset(assetId: string): Promise<Buffer | null> {
  const metadata = await assetMetadata(assetId)
  if (!metadata) return null
  try { return await readFile(join(metadata.root, assetId, 'image.webp')) }
  catch { return null }
}
