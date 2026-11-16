import { defineEventHandler, getRequestURL, setResponseHeader } from 'h3'

export default defineEventHandler(event => {
  if (!getRequestURL(event).pathname.startsWith('/i/')) return
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'referrer-policy', 'no-referrer')
  setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow, noarchive')
})
