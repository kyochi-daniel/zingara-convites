import { createError, defineEventHandler, setHeader } from 'h3'
import { readEvolutionInstallation } from '@zingara/core'
import { requireAdmin } from '../../../utils/admin'

export default defineEventHandler(async event => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAdmin(event)
  try { return { installation: await readEvolutionInstallation() } }
  catch { throw createError({ statusCode: 502, statusMessage: 'Evolution indisponível' }) }
})
