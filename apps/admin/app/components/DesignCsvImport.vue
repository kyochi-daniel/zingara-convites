<script setup lang="ts">
type CsvRow = { line: number; guest?: { name: string; phone: string }; errors: string[]; duplicates: string[] }

const props = defineProps<{
  rows: CsvRow[]
  name: string
  acceptedRows: number[]
  importing: boolean
}>()
const emit = defineEmits<{
  choose: [event: Event]
  accept: [line: number, checked: boolean]
  import: []
}>()
const validCount = computed(() => props.rows.filter(row => !row.errors.length).length)
</script>

<template>
  <section class="panel import-panel design-csv-import" aria-labelledby="import-title">
    <div><span class="eyebrow">Importação manual</span><h2 id="import-title">Importar CSV</h2><p class="form-intro">Prévia não salva contatos. Escolha explicitamente cada linha válida antes de importar.</p></div>
    <div class="design-csv-import__file"><label for="csv-file">Arquivo CSV</label><input id="csv-file" type="file" accept=".csv,text/csv" @change="emit('choose', $event)"></div>
    <p v-if="name" class="file-name">{{ name }}<span>{{ rows.length }} linhas</span></p>
    <div v-if="rows.length" class="csv-preview" role="region" aria-label="Prévia do CSV">
      <div class="csv-heading"><span>Usar</span><span>Linha e contato</span><span>Validação</span></div>
      <label v-for="row in rows" :key="row.line" class="csv-row" :class="{ invalid: row.errors.length, duplicate: row.duplicates.length }">
        <input type="checkbox" :disabled="!!row.errors.length" :checked="acceptedRows.includes(row.line)" @change="emit('accept', row.line, ($event.target as HTMLInputElement).checked)">
        <span><strong>Linha {{ row.line }}</strong><small>{{ row.guest?.name || 'Contato inválido' }} · {{ row.guest?.phone || '—' }}</small></span>
        <span class="csv-feedback"><small v-for="message in [...row.errors, ...row.duplicates]" :key="message">{{ message }}</small><small v-if="!row.errors.length && !row.duplicates.length">Válida</small></span>
      </label>
      <div class="import-actions"><span>{{ acceptedRows.length }} selecionados de {{ validCount }} válidos</span><button class="button primary" type="button" :disabled="!acceptedRows.length || importing" @click="emit('import')">{{ importing ? 'Importando…' : 'Importar selecionados' }}</button></div>
    </div>
  </section>
</template>
