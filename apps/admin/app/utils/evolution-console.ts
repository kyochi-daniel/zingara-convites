export type EvolutionInventoryItem = {
  instanceName: string
  channel: 'baileys' | 'cloud' | 'unknown'
  state: string
  localState?: string
  maskedNumber?: string
  ownership: 'propria' | 'protegida'
  connectionId?: string
}

export function linkableEvolutionInstances(items: EvolutionInventoryItem[]) {
  return items.filter(item => item.ownership === 'protegida' && item.channel !== 'unknown' && /^zingara-[a-z0-9-]{6,80}$/.test(item.instanceName))
}

export function canActivateEvolutionInstance(item: EvolutionInventoryItem) {
  return item.ownership === 'propria' && !!item.connectionId && item.localState === 'ready'
}

export function canPairEvolutionInstance(item: EvolutionInventoryItem, currentState?: string) {
  const state = currentState ?? item.state
  return canActivateEvolutionInstance(item) && item.channel === 'baileys' && (state === 'disconnected' || state === 'connecting')
}

export function evolutionQrActionLabel(state: string, hasQr: boolean) {
  if (state !== 'connecting') return 'Iniciar pareamento por QR (mostrar QR)'
  return hasQr ? 'Renovar QR de pareamento' : 'Mostrar ou renovar QR de pareamento'
}

export function evolutionQrImageSrc(value?: string) {
  if (!value) return ''
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value)) return value
  if (!/^[a-z\d+/=]+$/i.test(value)) return ''
  const mime = value.startsWith('iVBORw0KGgo') ? 'png' : value.startsWith('/9j/') ? 'jpeg' : value.startsWith('UklGR') ? 'webp' : ''
  return mime ? `data:image/${mime};base64,${value}` : ''
}
