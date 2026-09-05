import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4176/owiki/', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'SITE_BASE=/owiki/ pnpm build && SITE_BASE=/owiki/ pnpm preview --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/owiki/',
    reuseExistingServer: false,
  },
})
