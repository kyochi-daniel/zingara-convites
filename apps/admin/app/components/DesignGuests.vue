<template>
  <section class="design-guests" aria-labelledby="design-guests-title">
    <header class="guests-heading">
      <div>
        <h1 id="design-guests-title">Convidados</h1>
        <p class="desktop-subtitle">Gerencie sua lista e categorias. {{ statusEventName ? `RSVP: ${statusEventName}.` : 'RSVP disponível após publicar convites.' }}</p>
        <p class="mobile-subtitle">{{ statusEventName ? `RSVP: ${statusEventName}.` : 'Gerencie sua lista e categorias.' }}</p>
      </div>
      <div class="heading-actions">
        <button class="import-button" type="button" @click="emit('import')">
          <img src="/design/guests/import.svg" alt="">
          Importar
        </button>
        <button class="new-button" type="button" @click="emit('new')">
          <img src="/design/guests/add.svg" alt="">
          Novo convidado
        </button>
      </div>
    </header>

    <section class="rsvpfilter" aria-labelledby="guest-rsvp-filter-title">
      <div class="rsvpfield">
        <label id="guest-rsvp-filter-title" for="guest-rsvp-event">RSVP exibido na tabela</label>
        <select id="guest-rsvp-event" :value="rsvpEventId" :disabled="rsvpLoading || !rsvpEvents.length" @change="setRsvpEvent">
          <option value="">Selecione um evento</option>
          <option v-for="event in rsvpEvents" :key="event.id" :value="event.id">{{ event.name }}</option>
        </select>
      </div>
      <p v-if="rsvpError" class="rsvphint error" role="alert">{{ rsvpError }}</p>
      <p v-else-if="rsvpLoading" class="rsvphint" role="status">Carregando respostas do evento…</p>
      <p v-else-if="rsvpEventId" class="rsvphint">A coluna RSVP mostra somente convites deste evento.</p>
      <p v-else class="rsvphint">{{ rsvpEvents.length ? 'Escolha o evento antes de interpretar o status RSVP.' : 'Nenhum evento publicado disponível para RSVP.' }}</p>
    </section>

    <form class="guest-toolbar" role="search" @submit.prevent="search()">
      <div class="search-box">
        <img src="/design/guests/search.svg" alt="">
        <label class="visually-hidden" for="design-guests-search">Buscar convidados</label>
        <input id="design-guests-search" v-model="searchText" type="search" maxlength="100" placeholder="Buscar por nome, telefone ou e-mail...">
      </div>
      <button class="filter-button" type="submit">
        <img src="/design/guests/search.svg" alt="">
        <span>Buscar</span>
      </button>
    </form>

    <nav v-if="categories.length" class="category-list" aria-label="Filtrar por categoria">
      <button
        class="category-chip"
        :class="{ active: !activeTag }"
        type="button"
        :aria-pressed="!activeTag"
        @click="search('')"
      >
        <span>Todos</span>
        <small>{{ allTotal ?? guestTotal }} convidados</small>
      </button>
      <button
        v-for="category in categories"
        :key="category.name"
        class="category-chip"
        :class="{ active: activeTag === category.name }"
        type="button"
        :aria-pressed="activeTag === category.name"
        @click="search(activeTag === category.name ? '' : category.name)"
      >
        <span>{{ category.name }}</span>
        <small v-if="category.count !== undefined">{{ category.count }} nesta página</small>
      </button>
    </nav>

    <div class="guest-content">
      <section class="guest-list-panel" aria-labelledby="guest-list-title">
        <header class="list-heading">
          <div>
            <h2 id="guest-list-title">Convidados cadastrados</h2>
            <p>{{ guestTotal }} registros encontrados</p>
          </div>
          <label class="pagesize">
            <span>Linhas por página</span>
            <select :value="pageSize" @change="setPageSize">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
          <span class="mobile-total">{{ guestTotal }}</span>
        </header>

        <div class="tablewrap">
          <div class="table-heading" aria-hidden="true">
            <span>Convidado</span><span>Telefone</span><span>País</span><span>Etiquetas</span><span>WhatsApp</span><span>RSVP</span><span>Ações</span>
          </div>
          <p v-if="loading" class="empty-guests" role="status">Carregando convidados…</p>
          <ul v-else-if="guests.length" class="guest-list">
            <li v-for="(guest, index) in guests" :key="guest.id" class="guest-card guest-row">
              <span class="guest-avatar" :class="`color-${index % 6}`" aria-hidden="true">{{ firstName(guest.name) }}</span>
              <span class="guest-info">
                <strong>{{ guest.name }}</strong>
                <small class="guest-email">{{ guest.email || 'Sem e-mail' }}</small>
                <small class="guest-tag">{{ guest.phone || 'Sem telefone' }} · {{ guest.tags?.join(', ') || 'Sem etiqueta' }}</small>
              </span>
              <span class="phone">{{ guest.phone || '—' }}</span>
              <span class="country">{{ countryLabel(guest.phone) }}</span>
              <span class="tags" :title="guest.tags?.join(', ') || 'Sem etiqueta'">{{ guest.tags?.join(', ') || 'Sem etiqueta' }}</span>
              <span class="consent" :class="{ allowed: guest.whatsappConsent }">{{ guest.whatsappConsent ? 'Autorizado' : 'Sem autorização' }}</span>
              <span v-if="statusLabel(guest.status)" class="status-badge" :class="guest.status === 'pending' ? 'pending' : guest.status === 'declined' ? 'declined' : guest.status === 'revoked' ? 'revoked' : 'confirmed'">
                <img :src="`/design/guests/${statusIcon(guest.status)}.svg`" alt="">
                {{ statusLabel(guest.status) }}
              </span>
              <span v-else class="status-badge empty">{{ rsvpLoading ? 'Carregando…' : rsvpEventId ? 'Sem convite' : 'Selecione evento' }}</span>
              <button class="edit-guest" type="button" :aria-label="`Editar ${guest.name}`" @click="emit('edit', guest.id)">
                <span aria-hidden="true">✎</span>
              </button>
            </li>
          </ul>
          <p v-else class="empty-guests">Nenhum convidado encontrado.</p>
        </div>

        <footer class="pagination" aria-label="Paginação de convidados">
          <span>Mostrando {{ pageStart }}–{{ pageEnd }} de {{ guestTotal }} · Página {{ page }} de {{ pageCount }}</span>
          <div>
            <button type="button" :disabled="page <= 1" @click="emit('page', page - 1)">Anterior</button>
            <button type="button" :disabled="page >= pageCount" @click="emit('page', page + 1)">Próxima</button>
          </div>
        </footer>
      </section>

    </div>
  </section>
</template>

<script setup lang="ts">
type GuestStatus = 'accepted' | 'pending' | 'declined' | 'confirmed' | 'revoked'
type Guest = {
  id: string
  name: string
  email?: string
  phone?: string
  tags?: string[]
  status?: GuestStatus
  whatsappConsent?: boolean
}
type Category = { name: string; count?: number }
type RsvpEvent = { id: string; name: string }

const props = withDefaults(defineProps<{
  guests: Guest[]
  page?: number
  pageSize?: number
  total?: number
  allTotal?: number
  query?: string
  tags?: Category[]
  activeTag?: string
  statusEventName?: string
  loading?: boolean
  rsvpEvents?: RsvpEvent[]
  rsvpEventId?: string
  rsvpLoading?: boolean
  rsvpError?: string
}>(), {
  page: 1,
  pageSize: 100,
  query: '',
  tags: () => [],
  activeTag: '',
  loading: false,
  rsvpEvents: () => [],
  rsvpEventId: '',
  rsvpLoading: false,
  rsvpError: '',
})

const emit = defineEmits<{
  search: [value: { query: string; tag: string }]
  edit: [id: string]
  import: []
  new: []
  page: [value: number]
  pagesize: [value: number]
  rsvpevent: [value: string]
}>()

const searchText = ref(props.query)
const categories = computed<Category[]>(() => {
  if (props.tags.length) return props.tags
  const counts = new Map<string, number>()
  for (const guest of props.guests) {
    for (const tag of guest.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  if (props.activeTag && !counts.has(props.activeTag)) counts.set(props.activeTag, 0)
  return [...counts].map(([name, count]) => ({ name, count }))
})
const guestTotal = computed(() => props.total ?? props.guests.length)
const pageCount = computed(() => Math.max(1, Math.ceil(guestTotal.value / props.pageSize)))
const pageStart = computed(() => guestTotal.value ? ((props.page - 1) * props.pageSize) + 1 : 0)
const pageEnd = computed(() => Math.min(props.page * props.pageSize, guestTotal.value))
const firstName = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
const statusLabels: Record<string, string> = {
  accepted: 'Confirmado', confirmed: 'Confirmado', pending: 'Pendente', declined: 'Recusou', revoked: 'Revogado',
}
const statusLabel = (status?: GuestStatus) => statusLabels[status ?? ''] ?? ''
const statusIcon = (status?: GuestStatus) => status === 'pending' ? 'pending' : status === 'accepted' || status === 'confirmed' ? 'confirmed' : 'declined'
const countryLabel = (phone?: string) => phone?.startsWith('+595') ? 'Paraguai' : phone?.startsWith('+55') ? 'Brasil' : 'Outro'

watch(() => props.query, value => { searchText.value = value })

function search(tag = props.activeTag) {
  emit('search', { query: searchText.value.trim(), tag })
}

function setPageSize(event: Event) {
  emit('pagesize', Number((event.target as HTMLSelectElement).value))
}

function setRsvpEvent(event: Event) {
  emit('rsvpevent', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped lang="sass">
.design-guests
  --guests-page: #0e0f10
  --guests-panel: #171819
  --guests-control: #121315
  --guests-border: rgba(53, 55, 58, .82)
  --guests-text: #edeaf0
  --guests-muted: #85818a
  min-height: 100%
  padding: 28px clamp(20px, 2.2vw, 32px) 40px
  color: var(--guests-text)
  background: var(--guests-page)
  font-family: Inter, ui-sans-serif, system-ui, sans-serif

button, input
  font: inherit

button
  cursor: pointer

.guests-heading
  display: flex
  align-items: center
  justify-content: space-between
  gap: 20px
  margin-bottom: 20px

  h1
    margin: 0 0 4px
    font-size: 24px
    line-height: 1.15

  p
    margin: 0
    color: var(--guests-muted)
    font-size: 11px

.rsvpfilter
  display: flex
  align-items: end
  gap: 14px
  margin: 0 0 18px 0
  padding: 12px 14px 12px 14px
  background: var(--guests-control)
  border: 1px solid var(--guests-border)
  border-radius: 14px 14px 14px 14px

.rsvpfield
  display: flex
  width: min(100%, 320px)
  flex-direction: column
  gap: 6px

  label
    color: var(--guests-text)
    font-size: 10px

  select
    min-height: 36px
    padding: 0 10px 0 10px
    color: var(--guests-text)
    background: var(--guests-panel)
    border: 1px solid var(--guests-border)
    border-radius: 9px 9px 9px 9px
    font: inherit
    font-size: 11px

.rsvphint
  margin: 0
  color: var(--guests-muted)
  font-size: 10px
  line-height: 1.4

  &.error
    color: var(--design-accent)

.mobile-subtitle, .mobile-total
  display: none

.heading-actions, .guest-toolbar, .pagination, .pagination > div
  display: flex
  align-items: center
  gap: 10px

.heading-actions button, .filter-button, .pagination button
  min-height: 40px
  padding: 0 14px
  border: 1px solid var(--guests-border)
  border-radius: 12px
  color: #e5e2e8
  background: #171819
  font-size: 11px

.heading-actions button
  display: inline-flex
  align-items: center
  gap: 9px

.heading-actions img, .search-box img, .edit-guest img, .status-badge img
  display: block

.heading-actions .new-button
  border: 0
  color: #28272c
  background: linear-gradient(105deg, #f5f1b0, #d9e2ff 54%, #e9d0f4)
  font-weight: 650

.guest-toolbar
  justify-content: flex-end
  margin-bottom: 18px

.search-box
  display: flex
  width: min(100%, 300px)
  min-height: 42px
  align-items: center
  gap: 10px
  padding: 0 12px
  border: 1px solid var(--guests-border)
  border-radius: 12px
  background: #161719

  input
    width: 100%
    min-width: 0
    border: 0
    outline: 0
    color: var(--guests-text)
    background: transparent
    font-size: 11px

    &::placeholder
      color: #77747c

.filter-button
  min-width: 78px
  display: inline-flex
  align-items: center
  justify-content: center
  gap: 9px

.category-list
  display: grid
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr))
  gap: 12px
  margin-bottom: 22px

.category-chip
  display: grid
  min-height: 64px
  align-content: center
  justify-items: start
  gap: 6px
  padding: 0 14px
  border: 1px solid rgba(53, 55, 58, .55)
  border-radius: 14px
  color: #dedbe1
  background: #171819
  text-align: left

  span
    font-size: 11px

  small
    color: var(--guests-muted)
    font-size: 10px

  &.active
    border-color: transparent
    color: #26252a
    background: linear-gradient(105deg, #f5f1b0, #d9e2ff 54%, #e9d0f4)

    small
      color: #5e5967

.guest-content
  display: grid
  grid-template-columns: minmax(0, 1fr)
  align-items: stretch
  gap: 16px

.guest-list-panel
  min-width: 0
  border: 1px solid var(--guests-border)
  border-radius: 20px
  background: var(--guests-panel)

.guest-list-panel
  padding: 20px

.list-heading
  display: flex
  justify-content: space-between
  align-items: center
  margin-bottom: 16px

  h2, p
    margin: 0

  h2
    font-size: 14px
    font-weight: 600

  p
    margin-top: 5px
    color: var(--guests-muted)
    font-size: 10px

.pagesize
  display: flex
  align-items: center
  gap: 8px
  color: var(--guests-muted)
  font-size: 10px

  select
    min-height: 32px
    padding: 0 8px
    color: var(--guests-text)
    background: var(--guests-control)
    border: 1px solid var(--guests-border)
    border-radius: 8px
    font: inherit

.tablewrap
  width: 100%
  overflow-x: auto
  scrollbar-color: var(--design-muted) var(--design-bg)
  scrollbar-width: thin

.table-heading, .guest-row
  display: grid
  min-width: 1010px
  grid-template-columns: minmax(200px, 1.7fr) minmax(135px, 1fr) 82px minmax(135px, 1fr) 126px 112px 42px
  align-items: center
  gap: 12px

.table-heading
  min-height: 36px
  padding: 0 12px
  border-radius: 11px
  color: #77747c
  background: #121315
  font-size: 8px
  text-transform: uppercase

.guest-list
  margin: 0
  padding: 0
  list-style: none

.guest-card
  display: grid
  min-height: 68px
  padding: 0 8px
  border-bottom: 1px solid #282a2d

  &:last-child
    border-bottom: 0

.guest-avatar
  display: grid
  width: 38px
  height: 38px
  grid-column: 1
  grid-row: 1
  place-items: center
  border-radius: 50%
  color: #f2edf4
  font-size: 10px
  font-weight: 600

.color-0
  background: #51496b
.color-1
  background: #31594e
.color-2
  background: #505267
.color-3
  background: #64447e
.color-4
  background: #536743
.color-5
  background: #654457

.guest-info
  display: grid
  min-width: 0
  grid-column: 1
  grid-row: 1
  gap: 5px
  padding-left: 48px

  strong, small
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap

  strong
    color: #edeaf0
    font-size: 11px
    font-weight: 500

  small
    color: #77737c
    font-size: 9px

.guest-tag
  display: none

.phone, .country, .tags
  max-width: 100%
  overflow: hidden
  font-size: 9px
  text-overflow: ellipsis
  white-space: nowrap

.phone
  color: var(--guests-text)

.country
  color: var(--guests-muted)

.tags
  color: var(--guests-muted)

.consent
  justify-self: start
  padding: 6px 10px
  border: 1px solid var(--guests-border)
  border-radius: 14px
  color: var(--guests-muted)
  background: var(--guests-control)
  font-size: 9px
  white-space: nowrap

  &.allowed
    color: #b9f2ce
    border-color: #1e3026
    background: #1e3026

.status-badge
  display: inline-flex
  width: max-content
  align-items: center
  gap: 5px
  padding: 6px 10px
  border-radius: 14px
  font-size: 9px
  white-space: nowrap

  &.confirmed
    color: #b9f2ce
    background: #1e3026
  &.pending
    color: #efe59b
    background: #363321
  &.declined, &.revoked
    color: #ff9da4
    background: #3b2527
  &.empty
    color: var(--guests-muted)
    background: var(--guests-control)

.edit-guest
  display: grid
  width: 32px
  height: 32px
  grid-column: 7
  grid-row: 1
  place-items: center
  border: 0
  border-radius: 10px
  background: #141517
  color: #e5e2e8
  font-size: 17px

  &:focus-visible
    outline: 2px solid #f5f1b0
    outline-offset: 2px

.empty-guests
  margin: 24px 0
  color: var(--guests-muted)
  font-size: 12px
  text-align: center

.pagination
  justify-content: space-between
  margin-top: 10px
  color: var(--guests-muted)
  font-size: 10px

  button
    min-height: 32px
    padding: 0 10px
    font-size: 10px

    &:disabled
      cursor: default
      opacity: .45

.visually-hidden
  position: absolute
  width: 1px
  height: 1px
  overflow: hidden
  clip: rect(0, 0, 0, 0)
  white-space: nowrap
  clip-path: inset(50%)

@media (max-width: 860px)
  .design-guests
    min-height: 100vh
    padding: 54px 20px 100px

  .guests-heading
    align-items: flex-start
    margin-bottom: 22px

    h1
      font-size: 32px

  .desktop-subtitle, .heading-actions
    display: none

  .mobile-subtitle
    display: block
    font-size: 13px !important

  .guest-toolbar
    justify-content: stretch
    gap: 10px
    margin-bottom: 16px

  .rsvpfilter
    align-items: stretch
    flex-direction: column
    gap: 8px
    margin: 0 0 16px 0

  .rsvpfield
    width: 100%

  .search-box
    min-height: 54px
    flex: 1
    gap: 14px
    padding: 0 16px
    border-radius: 20px

    input
      font-size: 12px

  .filter-button
    position: relative
    width: 52px
    min-width: 52px
    height: 54px
    overflow: hidden
    padding: 0
    border-radius: 20px
    color: transparent

    img
      position: absolute
      top: 15px
      left: 15px

    span
      position: absolute
      width: 1px
      height: 1px
      overflow: hidden
      clip: rect(0, 0, 0, 0)

  .category-list
    grid-auto-columns: minmax(84px, 1fr)
    grid-auto-flow: column
    grid-template-columns: unset
    gap: 8px
    margin-bottom: 18px
    overflow-x: auto

  .category-chip
    min-height: 60px
    justify-items: center
    padding: 0 10px
    border: 0
    border-radius: 18px
    background: #121315

    span
      font-size: 12px
    small
      font-size: 10px

  .guest-content
    grid-template-columns: minmax(0, 1fr)
    gap: 10px

  .guest-list-panel
    display: contents

  .list-heading, .table-heading
    display: none

  .guest-list
    display: grid
    min-width: 0
    gap: 8px

  .tablewrap
    overflow: visible

  .guest-row
    position: relative
    min-height: 58px
    min-width: 0
    grid-template-columns: minmax(80px, 1fr) max-content 28px
    gap: 8px
    padding: 0 10px
    border: 0
    border-radius: 18px
    background: #151617

  .guest-avatar
    width: 38px
    height: 38px
    grid-column: 1
    grid-row: 1

  .guest-info
    padding-left: 48px

    strong
      font-size: 13px
    small
      color: #a9a5ae
      font-size: 11px

  .guest-email
    display: none
  .guest-tag
    display: block

  .phone, .country, .tags, .consent
    display: none

  .status-badge
    grid-column: 2
    grid-row: 1
    font-size: 10px

  .edit-guest
    width: 24px
    height: 30px
    grid-column: 3
    grid-row: 1
    background: transparent

  .pagination
    margin: 2px 0 8px

  .mobile-total
    display: block
    color: var(--guests-muted)
    font-size: 12px

  .empty-guests
    margin: 0
    padding: 20px
    border-radius: 16px
    background: #151617

@media (max-width: 420px)
  .design-guests
    padding-right: 14px
    padding-left: 14px

  .guest-row
    grid-template-columns: minmax(70px, 1fr) max-content 24px
    gap: 5px

  .status-badge
    gap: 4px
    padding: 5px 7px
</style>
