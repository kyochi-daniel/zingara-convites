<script setup lang="ts">
import { useContactImport } from './useContactImport'
const props = defineProps<{ organizationId: string; csrfToken: string }>()
const emit = defineEmits<{ imported: [] }>()
const { file, rows, selectedRows, whatsappConsent, authorizationSource, busy, error, notice, resetImport, selectRow, setConsent, setAuthorizationSource, chooseFile, importSelected } = useContactImport({
  organizationId: computed(() => props.organizationId), csrfToken: computed(() => props.csrfToken),
})
watch(() => props.organizationId, resetImport)
onBeforeUnmount(resetImport)
async function choose(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  if (selected) await chooseFile(selected)
  input.value = ''
}
async function save() { if (await importSelected()) emit('imported') }
</script>

<template>
  <section class="campaign-panel" aria-labelledby="campaign-import-title" :aria-busy="busy">
    <div><span class="eyebrow">Contatos</span><h3 id="campaign-import-title">Importar e revisar a lista</h3>
      <p>Envie CSV, TXT, DOC ou DOCX de até 256 KiB e 200 contatos. A prévia não grava contatos.</p></div>
    <label for="campaign-file">Arquivo com nomes e telefones</label>
    <input id="campaign-file" type="file" accept=".csv,.txt,.doc,.docx" :disabled="busy" @change="choose">
    <p v-if="busy" role="status">Analisando ou importando contatos…</p>
    <p v-if="error" class="form-message error" role="alert">{{ error }}</p>
    <p v-if="notice" class="form-message success" role="status">{{ notice }}</p>
    <template v-if="file && rows.length">
      <p><strong>{{ file.name }}</strong> · {{ selectedRows.length }} de {{ rows.length }} linhas selecionadas.</p>
      <p>Confira as duplicatas. Corrija linhas com erro no arquivo e envie novamente.</p>
      <p id="campaign-import-scroll-help" class="campaign-table-help">Deslize para os lados para ver telefone e revisão.</p>
      <div class="campaign-table-scroll" tabindex="0" role="region" aria-label="Prévia dos contatos importados" aria-describedby="campaign-import-scroll-help">
        <table class="campaign-table"><caption class="visually-hidden">Selecione explicitamente as linhas que deseja cadastrar</caption>
          <thead><tr><th scope="col">Importar</th><th scope="col">Linha</th><th scope="col">Nome</th><th scope="col">Telefone</th><th scope="col">Revisão</th></tr></thead>
          <tbody><tr v-for="row in rows" :key="row.line">
            <td><input type="checkbox" :aria-label="`Importar linha ${row.line}`" :checked="selectedRows.includes(row.line)" :disabled="busy || !row.guest || Boolean(row.errors.length)" @change="selectRow(row.line, ($event.target as HTMLInputElement).checked)"></td>
            <td>{{ row.line }}</td><td>{{ row.guest?.name || 'Nome ausente' }}</td><td>{{ row.guest?.phone || 'Telefone ausente' }}</td>
            <td>{{ [...row.errors, ...row.duplicates].join(' · ') || 'Pronto para revisão' }}</td>
          </tr></tbody>
        </table>
      </div>
      <label class="campaign-check" for="campaign-import-consent"><input id="campaign-import-consent" type="checkbox" :checked="whatsappConsent" :disabled="busy" @change="setConsent(($event.target as HTMLInputElement).checked)">
        Declaro que tenho autorização comprovável dos contatos selecionados para receber convites por WhatsApp.</label>
      <p>Sem essa declaração, os contatos serão cadastrados sem consentimento e ficarão fora das campanhas.</p>
      <template v-if="whatsappConsent"><label for="campaign-import-source">Fonte da autorização WhatsApp</label><input id="campaign-import-source" :value="authorizationSource" type="text" minlength="5" maxlength="300" required :disabled="busy" placeholder="Ex.: formulário de inscrição, data e registro da autorização" @input="setAuthorizationSource(($event.target as HTMLInputElement).value)"><p>Informe uma fonte verificável para todos os contatos selecionados. A autorização dos contatos já cadastrados será preservada.</p></template>
      <div class="campaign-actions"><button class="button quiet" type="button" :disabled="busy" @click="resetImport">Descartar prévia</button>
        <button class="button primary" type="button" :disabled="busy || !selectedRows.length || (whatsappConsent && authorizationSource.trim().length < 5)" @click="save">Importar {{ selectedRows.length }} {{ selectedRows.length === 1 ? 'contato selecionado' : 'contatos selecionados' }}</button></div>
    </template>
  </section>
</template>
