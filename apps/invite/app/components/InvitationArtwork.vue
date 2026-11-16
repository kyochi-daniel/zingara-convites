<template>
  <SharedInvitationArtwork
    :template="template"
    :values="values"
    :date-label="dateLabel"
    :deadline-label="deadlineLabel"
    :image-url="imageUrl"
  />
</template>

<script setup lang="ts">
import type { TemplateInput, TemplateVariable } from '@zingara/contracts'
import SharedInvitationArtwork from '../../../../packages/invitation-ui/InvitationArtwork.vue'

defineProps<{
  template: TemplateInput
  values: Partial<Record<TemplateVariable, string | number>>
  dateLabel: string
  deadlineLabel: string
  imageUrl?: string
}>()
</script>
