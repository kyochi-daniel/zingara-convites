<script setup lang="ts">
import InvitationArtwork from '~/components/InvitationArtwork.vue'
import { usePublicInvitation } from '~/modules/public/usePublicInvitation'

const route = useRoute()
const token = computed(() => typeof route.params.token === 'string' ? route.params.token : '')
const rsvpPanel = ref<HTMLElement | null>(null)
const {
  invitation,
  loading,
  saving,
  unavailable,
  loadError,
  formError,
  notice,
  answer,
  companions,
  resultHeading,
  deadlinePassed,
  canReply,
  imageUrl,
  dateLabel,
  deadlineLabel,
  values,
  responseLabel,
  peopleCount,
  loadInvitation,
  addCompanion,
  saveResponse,
} = usePublicInvitation(token)

function scrollToRsvp() {
  rsvpPanel.value?.scrollIntoView({ block: 'start' })
}

useHead({
  title: 'Convite | Zingara',
  meta: [
    { name: 'robots', content: 'noindex, nofollow, noarchive' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})
</script>

<template>
  <main class="public-shell">
    <section v-if="loading" class="state-card" role="status" aria-live="polite">
      <h1>Carregando convite</h1>
      <p>Um momento, estamos abrindo seus detalhes.</p>
    </section>
    <section v-else-if="unavailable" class="state-card" role="alert">
      <h1>Este convite não está disponível</h1>
      <p>O link pode estar incorreto, ter expirado ou ter sido revogado. Peça um novo link à pessoa que convidou você.</p>
    </section>
    <section v-else-if="loadError" class="state-card" role="alert">
      <h1>Não conseguimos abrir o convite</h1>
      <p>{{ loadError }}</p>
      <button type="button" @click="loadInvitation">Tentar novamente</button>
    </section>
    <template v-else-if="invitation">
      <h1 v-if="imageUrl" class="sr">{{ invitation.event.name }}</h1>
      <p v-if="!imageUrl" class="addressed-to">Para <strong>{{ invitation.guest.name }}</strong></p>
      <div v-if="imageUrl" class="invitation-hero invitation-hero--image">
        <InvitationArtwork
          :template="invitation.template"
          :values="values"
          :date-label="dateLabel"
          :deadline-label="deadlineLabel"
          :image-url="imageUrl"
        />
        <a class="invitation-hero__cta" href="#responder" @click="scrollToRsvp">Confirmar presença</a>
      </div>
      <InvitationArtwork
        v-else
        :template="invitation.template"
        :values="values"
        :date-label="dateLabel"
        :deadline-label="deadlineLabel"
      />
      <section id="local" class="detail-panel" aria-labelledby="location-heading">
        <p class="section-kicker">Encontro</p>
        <h2 id="location-heading">{{ invitation.event.location }}</h2>
        <p>{{ invitation.event.address }}</p>
        <p>{{ dateLabel }}</p>
      </section>
      <section id="responder" ref="rsvpPanel" class="rsvp-panel" aria-labelledby="rsvp-heading">
        <p class="section-kicker">Sua resposta</p>
        <h2 id="rsvp-heading">Você poderá estar conosco?</h2>
        <p>Este convite é para <strong>{{ invitation.guest.name }}</strong>. Responda até {{ deadlineLabel }}.</p>
        <div class="current-response" role="status">
          <span>Resposta atual</span>
          <strong>{{ responseLabel }}</strong>
          <small v-if="invitation.response.status === 'accepted'">{{ peopleCount }} {{ peopleCount === 1 ? 'pessoa confirmada' : 'pessoas confirmadas' }}</small>
        </div>
        <p v-if="deadlinePassed" class="deadline-warning">O prazo de resposta terminou. Seu comprovante permanece acima.</p>
        <form v-else @submit.prevent="saveResponse">
          <fieldset>
            <legend>Escolha sua resposta</legend>
            <label class="answer-option">
              <input v-model="answer" type="radio" name="attendance" value="accepted" :disabled="saving">
              <span>Sim, confirmo presença</span>
            </label>
            <label class="answer-option">
              <input v-model="answer" type="radio" name="attendance" value="declined" :disabled="saving">
              <span>Não poderei ir</span>
            </label>
          </fieldset>
          <div v-if="answer === 'accepted' && invitation.companionLimit > 0" class="companions">
            <h3>Acompanhantes</h3>
            <p>Você pode incluir até {{ invitation.companionLimit }} {{ invitation.companionLimit === 1 ? 'pessoa' : 'pessoas' }}.
              <span v-if="invitation.companionNamesRequired">Informe o nome de cada uma.</span>
              <span v-else>Os nomes são opcionais.</span>
            </p>
            <div v-for="(name, index) in companions" :key="index" class="companion-row">
              <label :for="`companion-${index}`">Acompanhante {{ index + 1 }}</label>
              <div>
                <input
                  :id="`companion-${index}`"
                  v-model="companions[index]"
                  type="text"
                  maxlength="80"
                  autocomplete="off"
                  :required="invitation.companionNamesRequired"
                  :disabled="saving"
                  placeholder="Nome"
                >
                <button type="button" class="text-button" :aria-label="`Remover acompanhante ${index + 1}`" :disabled="saving" @click="companions.splice(index, 1)">Remover</button>
              </div>
            </div>
            <button v-if="companions.length < invitation.companionLimit" type="button" class="add-button" :disabled="saving" @click="addCompanion">Adicionar acompanhante</button>
          </div>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}
            <button v-if="formError.includes('Recarregue')" type="button" class="text-button" @click="loadInvitation">Recarregar convite</button>
          </p>
          <button class="submit-button" type="submit" :disabled="!canReply || !answer">{{ saving ? 'Salvando resposta…' : 'Salvar resposta' }}</button>
        </form>
        <div v-if="notice" class="receipt" role="status" aria-live="polite">
          <h3 ref="resultHeading" tabindex="-1">{{ notice }}</h3>
          <p>Você pode alterar sua resposta até {{ deadlineLabel }}.</p>
        </div>
      </section>
    </template>
    <footer>Convite pessoal · Zingara</footer>
  </main>
</template>

<style scoped lang="sass">
@use '~/assets/_invitation-hero.sass'

.public-shell
  width: min(100% - 28px, 880px)
  margin: 0 auto
  padding: 22px 0 46px

.addressed-to
  margin: 0 0 12px
  color: #b2aeb7
  font-size: 13px

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

.detail-panel, .rsvp-panel, .state-card
  margin-top: 22px
  padding: clamp(22px, 5vw, 42px)
  background: #171819
  border: 1px solid #343539
  border-radius: 18px

.section-kicker
  margin: 0 0 9px
  color: #f2f1d0
  font: 750 10px/1.3 Arial, sans-serif
  letter-spacing: .15em
  text-transform: uppercase

h2
  margin: 0 0 13px
  color: #f5f3f7
  font: 650 clamp(26px, 5vw, 38px)/1.1 Inter, ui-sans-serif, system-ui, sans-serif

.detail-panel p:not(.section-kicker), .rsvp-panel > p:not(.section-kicker), .state-card p
  margin: 8px 0
  color: #a8a4ad
  line-height: 1.6

.current-response
  display: grid
  gap: 4px
  margin: 24px 0
  padding: 16px 18px
  background: #202224
  border-left: 3px solid #f2f1d0

  span
    color: #a8a4ad
    font-size: 12px

  strong
    color: #f5f3f7

  small
    color: #a8a4ad

fieldset
  display: grid
  gap: 10px
  margin: 0
  padding: 0
  border: 0

legend
  margin-bottom: 11px
  font-weight: 700

.answer-option
  display: flex
  min-height: 52px
  align-items: center
  gap: 12px
  padding: 11px 14px
  border: 1px solid #343539
  border-radius: 14px
  cursor: pointer

  &:has(input:checked)
    border-color: #f2f1d0
    background: #252629

  input
    width: 18px
    height: 18px
    accent-color: #f2f1d0

.companions
  margin-top: 28px

  h3
    margin: 0 0 6px
    font: 650 25px/1.2 Inter, ui-sans-serif, system-ui, sans-serif

  p
    color: #a8a4ad
    font-size: 13px
    line-height: 1.5

.companion-row
  display: grid
  gap: 7px
  margin-top: 16px

  label
    font-size: 13px
    font-weight: 700

  div
    display: flex
    gap: 10px
    align-items: center

  input
    min-width: 0
    min-height: 44px
    flex: 1
    padding: 10px 12px
    color: #f5f3f7
    background: #202224
    border: 1px solid #343539
    border-radius: 10px
    font: inherit

button
  cursor: pointer
  font: inherit

button:disabled
  cursor: not-allowed
  opacity: .55

button:focus-visible, input:focus-visible, a:focus-visible
  outline: 3px solid #f2f1d0
  outline-offset: 3px

.text-button
  padding: 6px
  color: #f2f1d0
  background: none
  border: 0
  text-decoration: underline

.add-button
  min-height: 44px
  margin-top: 13px
  padding: 10px 14px
  color: #f2f1d0
  background: #202224
  border: 1px solid #343539
  border-radius: 10px

.submit-button, .state-card button
  min-height: 48px
  margin-top: 24px
  padding: 12px 20px
  color: #171719
  background: linear-gradient(100deg, #f5f1b0, #d8e0ff 54%, #ebd3f4)
  border: 0
  border-radius: 12px
  font-weight: 700

.form-error, .deadline-warning
  padding: 13px 15px
  color: #f4b8ab
  background: #2b1d1d
  border-left: 3px solid #d77d76
  line-height: 1.5

.receipt
  margin-top: 23px
  padding: 16px
  background: #1b2922
  border-left: 3px solid #a8e0bf

  h3, p
    margin: 0

  p
    margin-top: 6px
    font-size: 13px

footer
  padding: 28px 0 0
  color: #8f8b94
  font-size: 11px
  text-align: center

@media (max-width: 520px)
  .companion-row div
    align-items: stretch
    flex-direction: column

  .text-button
    align-self: flex-start

@media (prefers-reduced-motion: no-preference)
  .answer-option, .submit-button, .add-button
    transition: background-color .16s ease, border-color .16s ease
</style>
