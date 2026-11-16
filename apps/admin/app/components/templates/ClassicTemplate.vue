<script setup lang="ts">
import type { TemplateInput, TemplateVariable } from '@zingara/contracts'
import EditorialTemplate from './EditorialTemplate.vue'

defineProps<{
  template: TemplateInput
  values: Partial<Record<TemplateVariable, string | number>>
  imageUrl?: string
  dateLabel: string
  deadlineLabel: string
}>()
</script>

<template>
  <EditorialTemplate :template="template" :values="values" :image-url="imageUrl" :date-label="dateLabel" :deadline-label="deadlineLabel" />
</template>
