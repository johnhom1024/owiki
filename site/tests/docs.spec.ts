import { test, expect } from '@playwright/test'

const slugs = ['introduction', 'quickstart', 'docker', 'configuration', 'development', 'maintenance', 'plugin', 'sync', 'web', 'faq']

test('homepage links to docs; deep links, translations and assets survive refresh', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./?lang=zh')
  await page.getByRole('link', { name: '使用文档', exact: true }).click()
  await expect(page).toHaveURL(/\/owiki\/docs\/\?page=quickstart/)
  for (const lang of ['zh', 'en']) {
    for (const slug of slugs) {
      await page.goto(`docs/?page=${slug}&lang=${lang}`)
      await expect(page.locator('h1')).not.toBeEmpty()
      await expect(page.locator('h1')).not.toContainText(/not found|不存在/)
      await expect(page.locator('article section')).not.toHaveCount(0)
      for (const img of await page.locator('article img').all()) {
        await img.scrollIntoViewIfNeeded()
        await expect.poll(() => img.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0)
      }
    }
  }
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(errors).toEqual([])
})

test('navigation, search, language, history, anchors and clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('docs/?page=quickstart&lang=zh')
  const nav = page.getByRole('navigation', { name: '使用文档', exact: true })
  await nav.locator('a[href*="page=docker"]').click()
  await expect(page).toHaveURL(/page=docker/)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(/page=quickstart/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.goForward()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.goBack()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const search = page.getByRole('textbox', { name: 'Search documentation' })
  await search.fill('xyz-no-matches-123')
  await expect(page.getByRole('status')).toContainText('No results')
  await search.fill('')
  await page.getByRole('button', { name: 'Copy code' }).first().click()
  await expect(page.getByText('Copied', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe('')
  await page.getByRole('navigation', { name: 'On this page', exact: true }).last().locator('a').last().click()
  await expect(page).toHaveURL(/#/)
  await page.reload()
  await expect(page.locator('h1')).not.toBeEmpty()
  const target = page.locator('article section').last()
  await expect(target).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})

test('mobile drawer traps focus, closes on Escape and selects pages without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('docs/?page=quickstart&lang=zh')
  const trigger = page.getByRole('button', { name: /使用文档/ })
  await trigger.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    expect(await page.getByRole('dialog').evaluate(node => node.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('dialog').locator('a[href*="page=plugin"]').click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).toHaveURL(/page=plugin/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/docs-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('docs/?page=docker&lang=en')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('quickstart links to Compose and separate development guide', async ({ page }) => {
  await page.goto('docs/?page=quickstart&lang=zh')
  await page.locator('article a[href="?page=docker#compose"]').click()
  await expect(page.locator('section#compose')).toBeInViewport()
  await expect(page.locator('section#compose-start code')).toHaveText('docker compose up -d')
  await page.goto('docs/?page=development&lang=zh')
  await expect(page.locator('article')).toContainText('cp .env.example .env')
  await expect(page.locator('article')).toContainText('make dev')
})

test('unknown document offers recovery and desktop layout fits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('docs/?page=missing&lang=en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
  await page.locator('article').getByRole('link', { name: 'Quick start', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/docs-desktop.png', fullPage: true })
})
