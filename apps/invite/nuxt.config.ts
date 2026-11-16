export default defineNuxtConfig({
  compatibilityDate: '2026-09-24',
  css: ['~/assets/main.sass'],
  runtimeConfig: {
    apiInternalUrl: process.env.API_INTERNAL_URL || 'http://localhost:4000',
    inviteOrigin: process.env.INVITE_ORIGIN || '',
  },
})
