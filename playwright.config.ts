import { defineConfig, devices } from '@playwright/test'

/**
 * One config, two targets. Unset `PLAYWRIGHT_BASE_URL` and Playwright boots
 * `pnpm dev` itself (api on :3001, web on :5173) and tests that; set it to a
 * deployed URL — `https://pr-123.yahn.ty.ler.dev` — and the identical spec runs
 * against real infrastructure with no server of its own.
 *
 * The specs assert structure, never content: they run against live Hacker
 * News, whose front page changes under the test.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'
const isLocal = !process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // Live HN is the origin behind every assertion, so the default 5s is tight
  // on a cold cache.
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(isLocal
    ? {
        webServer: {
          command: 'pnpm dev',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
})
