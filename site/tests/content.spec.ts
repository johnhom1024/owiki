import { test, expect } from '@playwright/test'
import { docs } from '../src/docs/content'

test('quickstart stays short and development uses the repository entry point', () => {
  for (const lang of ['zh', 'en'] as const) {
    const quickstart = docs[lang].find(p => p.slug === 'quickstart')!
    const command = quickstart.sections.find(s => s.id === 'start')!.code!.value
    expect(command.split('\n').length).toBeLessThanOrEqual(8)
    expect(command).toContain('docker run')
    expect(command).not.toMatch(/read -|umask|printf/)
    const development = docs[lang].find(p => p.slug === 'development')!
    const code = development.sections.map(s => s.code?.value || '').join('\n')
    expect(code).toContain('cp .env.example .env')
    expect(code).toContain('make dev')
  }
})

test('translations have matching routes, unique anchors and valid internal links', () => {
  expect(docs.zh.map(p => p.slug)).toEqual(docs.en.map(p => p.slug))
  for (const lang of ['zh', 'en'] as const) {
    const pages = docs[lang]
    expect(new Set(pages.map(p => p.slug)).size).toBe(pages.length)
    for (const page of pages) {
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.sections.length).toBeGreaterThan(0)
      expect(new Set(page.sections.map(s => s.id)).size).toBe(page.sections.length)
      for (const section of page.sections) {
        for (const link of section.links || []) {
          if (link.href.startsWith('?')) {
            const slug = new URLSearchParams(link.href.split('#')[0]).get('page')
            const linkedPage = pages.find(p => p.slug === slug)
            expect(linkedPage, link.href).toBeDefined()
            const anchor = link.href.split('#')[1]
            if (anchor) expect(linkedPage?.sections.some(s => s.id === anchor), link.href).toBe(true)
          }
          if (link.href.startsWith('#')) expect(page.sections.some(s => `#${s.id}` === link.href)).toBe(true)
        }
      }
    }
  }
  for (let i = 0; i < docs.zh.length; i++) {
    expect(docs.zh[i].sections.map(s => s.id)).toEqual(docs.en[i].sections.map(s => s.id))
  }
})
