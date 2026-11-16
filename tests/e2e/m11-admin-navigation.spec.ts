import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { loadEnvFile } from 'node:process'
import { test, expect } from '@playwright/test'
import { connectDatabase } from '../../packages/database/src/index'

loadEnvFile('.env')
let testDatabase = ''
const adminOrigin = process.env.ADMIN_ORIGIN!
const email = `m11-navigation-${randomUUID().slice(0, 8)}@example.test`
const password = createHash('sha256').update(`${process.env.JWT_SECRET}:m11-navigation-e2e`).digest('hex')
const processes: ChildProcess[] = []

function luminance(color: string) {
  return color.match(/\d+/g)!.slice(0, 3).map(Number).reduce((sum, channel, index) => {
    const value = channel / 255
    return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index]!
  }, 0)
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return }
    catch { /* servidor ainda inicia */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Servidor não iniciou: ${url}`)
}

test.beforeAll(async () => {
  const uri = new URL(process.env.MONGODB_URI!)
  testDatabase = `zingara_e2e_${randomUUID().slice(0, 12)}`
  uri.pathname = `/${testDatabase}`
  process.env.MONGODB_URI = uri.toString()
  const bootstrap = spawn(process.execPath, ['--experimental-strip-types', 'apps/api/scripts/bootstrap-admin.ts'], {
    cwd: process.cwd(), env: { ...process.env, ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'ignore',
  })
  expect((await once(bootstrap, 'exit'))[0]).toBe(0)
  for (const [app, port, extra] of [
    ['api', process.env.API_PORT!, {}],
    ['admin', process.env.ADMIN_PORT!, { NUXT_API_INTERNAL_URL: process.env.API_INTERNAL_URL!, NUXT_ADMIN_ORIGIN: adminOrigin }],
  ] as const) {
    processes.push(spawn(process.execPath, [`apps/${app}/.output/server/index.mjs`], {
      cwd: process.cwd(), env: { ...process.env, ...extra, NITRO_PORT: port }, stdio: 'ignore',
    }))
  }
  await waitFor(`${process.env.API_INTERNAL_URL}/health`)
  await waitFor(adminOrigin)
}, 30_000)

test.afterAll(async () => {
  for (const child of processes) child.kill('SIGTERM')
  if (testDatabase) {
    const db = await connectDatabase()
    await db.connection.dropDatabase()
    await db.disconnect()
  }
})

test('navega entre organizações, configurações e perfil no desktop e mobile', async ({ page }) => {
  await page.goto(adminOrigin)
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await expect(page.getByRole('heading', { name: 'Suas organizações' })).toBeVisible()

  const sidebar = page.locator('.design-sidebar')
  const organization = sidebar.getByRole('combobox', { name: 'Organização' })
  await expect(sidebar.locator(':scope > :first-child')).toHaveClass(/design-organization-select/)
  await expect(sidebar.locator('.design-brand')).toHaveCount(0)
  const [headingColor, sidebarColor] = await Promise.all([
    sidebar.locator('.design-nav-heading').first().evaluate(node => getComputedStyle(node).color),
    sidebar.evaluate(node => getComputedStyle(node).backgroundColor),
  ])
  const [lighter, darker] = [luminance(headingColor), luminance(sidebarColor)].sort((a, b) => b - a)
  expect((lighter! + .05) / (darker! + .05)).toBeGreaterThanOrEqual(4.5)
  await page.locator('#organization-name').fill('M11 Alfa')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(organization.locator('option')).toHaveCount(2)
  await page.locator('#organization-name').fill('M11 Beta')
  await page.getByRole('button', { name: 'Criar organização' }).click()
  await expect(organization.locator('option')).toHaveCount(3)
  await organization.selectOption({ label: 'M11 Beta' })
  const selectedBeta = await organization.inputValue()
  expect(selectedBeta).toBeTruthy()
  await expect(organization).toHaveValue(selectedBeta)

  for (const area of ['events', 'guests'] as const) {
    const link = sidebar.getByRole('button', { name: area === 'events' ? 'Eventos' : 'Convidados' })
    const icon = link.locator('img.design-nav-icon')
    const idle = await icon.getAttribute('src')
    await link.click()
    const active = await icon.getAttribute('src')
    expect(idle).toBe(`/design/sidebar-${area}.svg`)
    expect(active).toBe(`/design/sidebar-${area}-active.svg`)
    const [idleSvg, activeSvg] = await Promise.all([idle, active].map(async path =>
      (await (await fetch(new URL(path!, adminOrigin))).text()).replace(/stroke="#[A-Fa-f0-9]+"/g, 'stroke="currentColor"'),
    ))
    expect(activeSvg).toBe(idleSvg)
  }

  const settings = sidebar.locator('.design-settings-menu > summary')
  await settings.focus()
  await page.keyboard.press('Enter')
  await expect(sidebar.getByRole('button', { name: 'Organizações' })).toBeVisible()
  await page.locator('.design-content').click({ position: { x: 20, y: 20 } })
  await expect(sidebar.getByRole('button', { name: 'Organizações' })).toBeHidden()
  await settings.focus()
  await page.keyboard.press('Enter')
  const profile = sidebar.locator('.design-profile-menu > summary')
  await profile.click()
  await expect(sidebar.locator('.design-settings-menu')).not.toHaveAttribute('open', '')
  await expect(sidebar.getByRole('button', { name: 'Sair' })).toBeVisible()
  await page.locator('.design-content').click({ position: { x: 20, y: 20 } })
  await expect(sidebar.getByRole('button', { name: 'Sair' })).toBeHidden()
  await settings.focus()
  await page.keyboard.press('Enter')
  await expect(sidebar.getByRole('button', { name: 'WhatsApp' })).toBeVisible()
  await sidebar.getByRole('button', { name: 'WhatsApp' }).click()
  await expect(page.locator('.design-page-title')).toHaveText('Conexão WhatsApp')
  await page.screenshot({ path: 'test-results/m11-navigation-desktop.png' })
  await settings.focus()
  await page.keyboard.press('Enter')
  await sidebar.getByRole('button', { name: 'Organizações' }).click()
  await expect(page.getByRole('region', { name: 'Organizações' }).getByRole('heading', { name: 'Organizações' })).toBeVisible()

  await profile.focus()
  await page.keyboard.press('Enter')
  await expect(sidebar.getByRole('button', { name: 'Sair' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sidebar.getByRole('button', { name: 'Sair' })).toBeHidden()
  await expect(profile).toBeFocused()
  await page.keyboard.press('Enter')
  await sidebar.getByRole('button', { name: 'Configurações' }).click()
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(sidebar).toBeHidden()
  const mobile = page.locator('.design-mobile-header')
  const mobileOrganization = mobile.getByRole('combobox', { name: 'Organização' })
  await expect(mobileOrganization).toBeVisible()
  await expect(mobileOrganization).toHaveValue(selectedBeta)
  expect((await mobileOrganization.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const mobileProfile = mobile.locator('.design-mobile-profile > summary')
  const avatarBox = (await mobileProfile.boundingBox())!
  expect(avatarBox.height).toBeGreaterThanOrEqual(44)
  expect(avatarBox.width).toBeGreaterThanOrEqual(44)
  const bottomNav = page.locator('.design-bottom-nav')
  await expect(bottomNav).toBeVisible()
  await page.screenshot({ path: 'test-results/m11-navigation-mobile.png' })
  await bottomNav.locator('.design-mobile-more > summary').focus()
  await page.keyboard.press('Enter')
  await expect(bottomNav.getByRole('button', { name: 'WhatsApp' })).toBeVisible()
  await page.locator('.design-content').click({ position: { x: 20, y: 20 } })
  await expect(bottomNav.getByRole('button', { name: 'WhatsApp' })).toBeHidden()
  await bottomNav.locator('.design-mobile-more > summary').focus()
  await page.keyboard.press('Enter')
  await mobileProfile.click()
  await expect(bottomNav.getByRole('button', { name: 'WhatsApp' })).toBeHidden()
  await expect(mobile.getByRole('button', { name: 'Sair' })).toBeVisible()
  await page.locator('.design-content').click({ position: { x: 20, y: 20 } })
  await expect(mobile.getByRole('button', { name: 'Sair' })).toBeHidden()
  await bottomNav.locator('.design-mobile-more > summary').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(bottomNav.getByRole('button', { name: 'WhatsApp' })).toBeHidden()
  for (const area of ['events', 'guests'] as const) {
    const link = bottomNav.getByRole('button', { name: area === 'events' ? 'Eventos' : 'Convidados' })
    const icon = link.locator('img')
    const idle = await icon.getAttribute('src')
    await link.click()
    const active = await icon.getAttribute('src')
    await expect(link).toHaveAttribute('aria-current', 'page')
    expect(idle).toBe(`/design/mobile-${area}.svg`)
    expect(active).toBe(`/design/mobile-${area}-active.svg`)
    const [idleSvg, activeSvg] = await Promise.all([idle, active].map(async path =>
      (await (await fetch(new URL(path!, adminOrigin))).text()).replace(/stroke="#[A-Fa-f0-9]+"/g, 'stroke="currentColor"'),
    ))
    expect(activeSvg).toBe(idleSvg)
  }
  await page.setViewportSize({ width: 320, height: 700 })
  expect((await mobileOrganization.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const narrowAvatar = (await mobileProfile.boundingBox())!
  expect(narrowAvatar.width).toBeGreaterThanOrEqual(44)
  expect(narrowAvatar.x + narrowAvatar.width).toBeLessThanOrEqual(320)
  await mobileProfile.click()
  await expect(mobile.getByRole('button', { name: 'Configurações' })).toBeVisible()
  await mobile.getByRole('button', { name: 'Sair' }).click()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
})
