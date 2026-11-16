<script setup lang="ts">
import { templateVariables } from '@zingara/contracts'

defineProps<{ modelValue?: string; preview: string; readOnly: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <section class="data-form" aria-labelledby="event-message-title">
    <h3 id="event-message-title">Mensagem WhatsApp</h3>
    <p class="form-intro">Este texto acompanha o link individual. A arte do convite tem seu próprio texto. Salve e publique antes de emitir convites. Convites já emitidos preservam a versão da emissão.</p>
    <label for="event-message-text">Mensagem WhatsApp do evento</label>
    <textarea id="event-message-text" :value="modelValue" :disabled="readOnly" required maxlength="3000" rows="7" aria-describedby="event-message-help" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"></textarea>
    <p id="event-message-help" class="form-intro">HTML e variáveis desconhecidas são rejeitados. A formatação contida nos dados é tratada como texto.</p>
    <details>
      <summary>Variáveis disponíveis para copiar</summary>
      <ul><li v-for="variable in templateVariables" :key="variable"><code v-text="'{{' + variable + '}}'"></code></li></ul>
    </details>
    <label for="event-message-preview">Prévia da mensagem WhatsApp</label>
    <textarea id="event-message-preview" :value="preview" readonly rows="8" aria-describedby="event-message-example"></textarea>
    <p id="event-message-example" class="preview-example">Nome e link fictícios para edição. Antes de aprovar um envio, gere a prévia do convite emitido em “Prévia e envios”. Nenhuma mensagem é enviada aqui.</p>
  </section>
</template>
