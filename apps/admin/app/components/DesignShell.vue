<template>
  <div ref="shell" class="design-shell" @keydown.esc="closeOnEscape">
    <aside class="design-sidebar" aria-label="Navegação principal">
      <label class="design-organization-select">
        <span>Organização</span>
        <select :value="selectedOrganizationId" :disabled="!organizations.length" @change="selectOrganization">
          <option value="">Selecione uma organização</option>
          <option v-for="organization in organizations" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
        </select>
      </label>

      <p class="design-nav-heading">Geral</p>
      <nav class="design-nav" aria-label="Geral">
        <button
          v-for="link in generalLinks"
          :key="link.area"
          class="design-nav-link"
          :class="{ 'is-active': isActive(link.area) }"
          :aria-current="isActive(link.area) ? 'page' : undefined"
          type="button"
          @click="navigate(link.area)"
        >
          <span class="design-nav-marker" aria-hidden="true" />
          <span class="design-nav-icon-frame"><img class="design-nav-icon" :src="desktopIcon(link.icon, isActive(link.area))" alt=""></span>
          <span class="design-nav-label">{{ link.label }}</span>
          <img v-if="isActive(link.area)" class="design-active-dot" src="/design/active-dot.svg" alt="">
        </button>
      </nav>

      <p class="design-nav-heading design-system-heading">Sistema</p>
      <nav class="design-nav" aria-label="Sistema">
        <details class="design-menu design-settings-menu" @toggle="closeOtherMenus">
          <summary class="design-nav-link" :class="{ 'is-active': isSettingsActive }" aria-label="Configurações">
            <span class="design-nav-marker" aria-hidden="true" />
            <span class="design-nav-icon-frame"><img class="design-nav-icon" src="/design/sidebar-settings.svg" alt=""></span>
            <span class="design-nav-label">Configurações</span>
            <span class="design-menu-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="design-settings-links">
            <button type="button" :aria-current="activeArea === 'organizations' ? 'page' : undefined" @click="navigate('organizations')">Organizações</button>
            <button type="button" :aria-current="activeArea === 'connection' ? 'page' : undefined" @click="navigate('connection')">WhatsApp</button>
          </div>
        </details>
      </nav>

      <div class="design-sidebar-footer">
        <details class="design-menu design-profile-menu" @toggle="closeOtherMenus">
          <summary class="design-profile design-profile-trigger" aria-label="Menu do perfil">
            <span class="avatar" aria-hidden="true">{{ adminInitials }}</span>
            <span class="design-profile-copy"><strong>{{ adminName }}</strong><small>{{ adminSubtitle }}</small></span>
            <span class="design-menu-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="design-menu-panel">
            <button type="button" @click="navigate('settings')">Configurações</button>
            <button type="button" @click="logout">Sair</button>
          </div>
        </details>
      </div>
    </aside>

    <div class="design-main-column">
      <header class="design-topbar" :class="{ 'has-toolbar': Boolean($slots.toolbar) }">
        <span class="design-page-title">{{ title }}</span>
        <div v-if="$slots.toolbar" class="design-topbar-actions"><slot name="toolbar" /></div>
      </header>

      <header class="design-mobile-header">
        <label class="design-organization-select">
          <span>Organização</span>
          <select :value="selectedOrganizationId" :disabled="!organizations.length" @change="selectOrganization">
            <option value="">Selecione uma organização</option>
            <option v-for="organization in organizations" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
          </select>
        </label>
        <details class="design-menu design-mobile-profile" @toggle="closeOtherMenus">
          <summary class="avatar design-profile-trigger" aria-label="Menu do perfil">{{ adminInitials }}</summary>
          <div class="design-menu-panel">
            <button type="button" @click="navigate('settings')">Configurações</button>
            <button type="button" @click="logout">Sair</button>
          </div>
        </details>
      </header>

      <main id="conteudo" class="design-content" tabindex="-1"><slot /></main>
    </div>

    <slot name="assistant" />

    <nav class="design-bottom-nav" aria-label="Navegação principal">
      <button
        v-for="link in generalLinks"
        :key="link.area"
        class="design-bottom-link"
        :class="{ 'is-active': isActive(link.area) }"
        :aria-current="isActive(link.area) ? 'page' : undefined"
        type="button"
        @click="navigate(link.area)"
      >
        <img :src="mobileIcon(link.icon, isActive(link.area))" alt="">
        <span>{{ link.label }}</span>
      </button>
      <details class="design-menu design-mobile-more" @toggle="closeOtherMenus">
        <summary class="design-bottom-link" :class="{ 'is-active': isSettingsActive }" aria-label="Mais opções">
          <img src="/design/mobile-more.svg" alt="">
          <span>Mais</span>
        </summary>
        <div class="design-menu-panel">
          <button type="button" @click="navigate('settings')">Configurações</button>
          <button type="button" @click="navigate('organizations')">Organizações</button>
          <button type="button" @click="navigate('connection')">WhatsApp</button>
        </div>
      </details>
    </nav>
  </div>
</template>

<script setup lang="ts">
type Area = 'home' | 'events' | 'guests' | 'other'
type OrganizationOption = { id: string; name: string }

const props = withDefaults(defineProps<{
  active?: Area
  activeArea?: string
  pageTitle?: string
  adminName?: string
  adminSubtitle?: string
  organizations?: OrganizationOption[]
  selectedOrganizationId?: string
}>(), {
  active: 'home',
  adminName: 'Admin',
  adminSubtitle: 'Administrador',
  organizations: () => [],
  selectedOrganizationId: '',
})

const emit = defineEmits<{
  navigate: [area: 'home' | 'events' | 'guests' | 'settings' | 'organizations' | 'connection']
  selectOrganization: [id: string]
  logout: []
}>()

const shell = ref<HTMLElement | null>(null)
const title = computed(() => props.pageTitle ?? ({ home: 'Início', events: 'Eventos', guests: 'Convidados', other: 'Painel' }[props.active]))
const adminInitials = computed(() => props.adminName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'A')
const isSettingsActive = computed(() => ['settings', 'organizations', 'connection'].includes(props.activeArea ?? ''))
const generalLinks = [
  { area: 'home', label: 'Início', icon: 'home' },
  { area: 'events', label: 'Eventos', icon: 'events' },
  { area: 'guests', label: 'Convidados', icon: 'guests' },
] as const

onMounted(() => document.addEventListener('pointerdown', closeOnOutside))
onUnmounted(() => document.removeEventListener('pointerdown', closeOnOutside))

function isActive(area: string) { return area === props.active }
function closeMenus() { shell.value?.querySelectorAll('details').forEach(menu => { menu.open = false }) }
function closeOtherMenus(event: Event) {
  const opened = event.currentTarget as HTMLDetailsElement
  if (!opened.open) return
  shell.value?.querySelectorAll<HTMLDetailsElement>('details.design-menu').forEach(menu => {
    if (menu !== opened) menu.open = false
  })
}
function closeOnOutside(event: PointerEvent) {
  if (!(event.target instanceof Node)) return
  shell.value?.querySelectorAll<HTMLDetailsElement>('details.design-menu[open]').forEach(menu => {
    if (!menu.contains(event.target as Node)) menu.open = false
  })
}
function closeOnEscape(event: KeyboardEvent) {
  const menu = (event.target as HTMLElement).closest('details')
  if (!menu?.open) return
  menu.open = false
  menu.querySelector('summary')?.focus()
  event.stopPropagation()
}
function navigate(area: 'home' | 'events' | 'guests' | 'settings' | 'organizations' | 'connection') {
  closeMenus()
  emit('navigate', area)
}
function logout() { closeMenus(); emit('logout') }
function selectOrganization(event: Event) { emit('selectOrganization', (event.target as HTMLSelectElement).value) }
function desktopIcon(icon: string, active: boolean) {
  return `/design/sidebar-${icon}${active ? '-active' : ''}.svg`
}
function mobileIcon(icon: string, active: boolean) {
  return `/design/mobile-${icon}${active ? '-active' : ''}.svg`
}
</script>

<style lang="sass" scoped>
@use '~/assets/_design-shell.sass'
</style>

<style lang="sass">
@use '~/assets/_admin-assistant.sass'
</style>
