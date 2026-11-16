<script setup lang="ts">
import type { TemplateInput, TemplateVariable } from '@zingara/contracts'
import InvitationArtwork from '../../../../../packages/invitation-ui/InvitationArtwork.vue'

defineProps<{
  template: TemplateInput
  values: Partial<Record<TemplateVariable, string | number>>
  imageUrl?: string
  dateLabel: string
  deadlineLabel: string
}>()
</script>

<template>
  <div class="admin-artwork-preview">
    <InvitationArtwork :template="template" :values="values" :image-url="imageUrl" :date-label="dateLabel" :deadline-label="deadlineLabel" />
  </div>
</template>

<style scoped lang="sass">
.admin-artwork-preview
  min-width: 0
  container-type: inline-size

  :deep(.artwork-inner)
    gap: 16px
    min-height: 550px
    padding: 30px 22px

  :deep(h1)
    font-size: clamp(32px, 7cqw, 46px)

  :deep(.artwork-links)
    pointer-events: none
</style>
