export function buildMediaTarget(apiInternalUrl: string, assetId: string): string | null {
  if (!/^[a-f0-9]{32}$/.test(assetId)) return null
  try {
    const base = new URL(apiInternalUrl)
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null
    return new URL(`/media/${assetId}`, base).toString()
  } catch { return null }
}
