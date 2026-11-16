import { createHash } from 'node:crypto'
import { connectDatabase, LoginAttemptModel } from '@zingara/database'
import { createError, getHeader, type H3Event } from 'h3'

export async function readGuestImportJson(event: H3Event) {
  if (!getHeader(event, 'content-type')?.startsWith('application/json')) throw createError({ statusCode: 415, statusMessage: 'Use application/json' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 360_448) throw createError({ statusCode: 413, statusMessage: 'Arquivo ultrapassa 256 KiB' })
    chunks.push(buffer)
  }
  let input: unknown
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw createError({ statusCode: 400, statusMessage: 'JSON inválido' }) }
  if (input && typeof input === 'object' && 'csv' in input && size > 16_384) throw createError({ statusCode: 413, statusMessage: 'Corpo muito grande' })
  return input
}

export async function consumeDocumentPreviewQuota(adminId: string) {
  const minute = Math.floor(Date.now() / 60_000)
  const subject = createHash('sha256').update(adminId).digest('hex')
  const key = `guest-document-preview:${subject}:${minute}`
  let accepted: boolean
  try {
    await connectDatabase()
    // Seed independently so concurrent first requests cannot reset the counter.
    try {
      await LoginAttemptModel.updateOne(
        { _id: key },
        { $setOnInsert: { count: 0, expiresAt: new Date((minute + 2) * 60_000) } },
        { upsert: true },
      )
    } catch (error: unknown) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 11000) throw error
    }
    const result = await LoginAttemptModel.updateOne({ _id: key, count: { $lt: 2 } }, { $inc: { count: 1 } })
    accepted = result.matchedCount === 1
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Prévia documental temporariamente indisponível' })
  }
  if (!accepted) throw createError({ statusCode: 429, statusMessage: 'Limite de dois processamentos DOC/DOCX por minuto. Aguarde ou use CSV/TXT.' })
}
