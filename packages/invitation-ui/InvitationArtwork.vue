<script setup lang="ts">
import { resolveTemplateText, type TemplateInput, type TemplateVariable } from '../contracts/src/index'

defineProps<{
  template: TemplateInput
  values: Partial<Record<TemplateVariable, string | number>>
  dateLabel: string
  deadlineLabel: string
  imageUrl?: string
}>()
</script>

<template>
  <template v-if="imageUrl">
    <img class="artwork-image" :src="imageUrl" :alt="`Convite para ${values['evento.nome']}`">
    <div class="sr">
      <p>{{ resolveTemplateText(template.subtitle, values) }}</p>
      <p>{{ resolveTemplateText(template.title, values) }}</p>
      <p>{{ resolveTemplateText(template.body, values) }}</p>
    </div>
  </template>
  <article
    v-else
    class="artwork"
    :class="`artwork--${template.layout}`"
    :style="{
      '--paper': template.colors.background,
      '--ink': template.colors.text,
      '--accent': template.colors.accent,
      textAlign: template.alignment,
      fontFamily: template.font === 'serif' ? 'Georgia, Times New Roman, serif' : 'Arial, sans-serif',
    }"
  >
    <div class="artwork-inner">
      <p class="artwork-overline">Zingara <span aria-hidden="true">✳</span> Convites</p>
      <div class="artwork-monogram" aria-hidden="true">Z</div>
      <p class="artwork-subtitle">{{ resolveTemplateText(template.subtitle, values) }}</p>
      <h1>{{ resolveTemplateText(template.title, values) }}</h1>
      <p class="artwork-body">{{ resolveTemplateText(template.body, values) }}</p>
      <div v-if="template.blocks.date || template.blocks.location" class="artwork-facts">
        <div v-if="template.blocks.date"><span>Quando</span><strong>{{ dateLabel }}</strong></div>
        <div v-if="template.blocks.location"><span>Onde</span><strong>{{ values['evento.local'] }}</strong></div>
      </div>
      <p v-if="template.blocks.rsvp" class="artwork-deadline">Confirme até {{ deadlineLabel }}</p>
      <div class="artwork-links">
        <a class="artwork-primary" href="#responder">{{ resolveTemplateText(template.primaryButtonText, values) }}</a>
        <a class="artwork-secondary" href="#local">{{ resolveTemplateText(template.secondaryButtonText, values) }}</a>
      </div>
    </div>
  </article>
</template>

<style scoped lang="sass">
.artwork
  --paper: #fff
  --ink: #18212f
  --accent: #a36a45
  color: var(--ink)
  background: var(--paper)
  border: 1px solid color-mix(in srgb, var(--accent), transparent 55%)
  box-shadow: 0 22px 60px rgba(30, 25, 20, .08)

.artwork-inner
  display: grid
  justify-items: center
  gap: 18px
  padding: clamp(28px, 7vw, 68px) clamp(22px, 7vw, 72px)

.artwork--classic
  padding: 12px
  border-radius: 18px

  .artwork-inner
    min-height: 620px
    align-content: center
    border: 1px solid var(--accent)
    border-radius: 12px

.artwork--editorial
  .artwork-inner
    min-height: 620px

.artwork-overline
  display: flex
  width: 100%
  justify-content: space-between
  margin: 0
  color: var(--accent)
  font: 700 11px/1.2 Arial, sans-serif
  letter-spacing: .14em
  text-transform: uppercase

.artwork-monogram
  display: grid
  width: 78px
  height: 78px
  place-items: center
  color: var(--accent)
  border: 1px solid var(--accent)
  border-radius: 50%
  font-size: 46px

.artwork-image
  display: block
  width: min(100%, 800px)
  height: auto
  margin: 0 auto 0 auto
  object-fit: contain
  border: 1px solid color-mix(in srgb, currentColor, transparent 82%)
  border-radius: 16px 16px 16px 16px

.sr
  position: absolute
  width: 1px
  height: 1px
  margin: -1px -1px -1px -1px
  padding: 0 0 0 0
  overflow: hidden
  clip: rect(0, 0, 0, 0)
  clip-path: inset(50%)
  white-space: nowrap

.artwork-subtitle
  margin: 4px 0 0
  color: var(--accent)
  font: 700 13px/1.5 Arial, sans-serif
  letter-spacing: .06em

h1
  max-width: 740px
  margin: 0
  font-size: clamp(38px, 8vw, 74px)
  font-weight: 400
  letter-spacing: -.045em
  line-height: 1.02

.artwork-body
  max-width: 560px
  margin: 0
  white-space: pre-line
  font-size: clamp(16px, 2vw, 19px)
  line-height: 1.6

.artwork-facts
  display: grid
  width: 100%
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))
  gap: 20px
  margin-top: 8px
  padding: 20px 0
  border-top: 1px solid color-mix(in srgb, var(--accent), transparent 50%)
  border-bottom: 1px solid color-mix(in srgb, var(--accent), transparent 50%)

  div
    display: grid
    gap: 7px

  span
    color: var(--accent)
    font: 700 10px/1.2 Arial, sans-serif
    letter-spacing: .13em
    text-transform: uppercase

  strong
    font-size: 15px
    font-weight: 400

.artwork-deadline
  margin: 0
  font-size: 14px

.artwork-links
  display: flex
  flex-wrap: wrap
  justify-content: center
  gap: 10px

  a
    min-height: 44px
    padding: 12px 18px
    border-radius: 4px
    font: 700 13px/1.3 Arial, sans-serif
    text-decoration: none

.artwork-primary
  color: #fff
  background: var(--accent)

.artwork-secondary
  color: var(--accent)
  border: 1px solid var(--accent)

a:focus-visible
  outline: 3px solid var(--ink)
  outline-offset: 3px

@media (max-width: 480px)
  .artwork-inner
    gap: 16px
    padding: 30px 22px

  .artwork--classic .artwork-inner, .artwork--editorial .artwork-inner
    min-height: 550px

  .artwork-facts
    grid-template-columns: 1fr
</style>
