import { defineConfig, devices } from '@playwright/test'

/**
 * One config, two targets. Unset `PLAYWRIGHT_BASE_URL` and Playwright boots
 * a server itself (Vite on :5173, `server/dev.ts` on :3001) and tests that;
 * set it to a deployed URL and the identical spec runs against real
 * infrastructure with no server of its own. `pnpm e2e:live` (no
 * `PLAYWRIGHT_BASE_URL`) boots `pnpm dev` against live HN; every other local
 * run boots `pnpm dev:e2e`, `HN_SOURCE=fixture`.
 *
 * `.claude/rules/testing.md`: `fullyParallel`, `workers: CI ? 2 : undefined`,
 * `retries: CI ? 1 : 0`, `expect.timeout: 5000`. Two projects: `chromium` runs
 * the whole suite except `e2e/live/**`, against fixtured HN; `live` runs only
 * `e2e/live/**`, against real HN, structural assertions only.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'
const isLocal = !process.env.PLAYWRIGHT_BASE_URL

// `.claude/rules/vercel.md`: this account's Deployment Protection is on for
// every deployment, so a remote run needs the bypass header to get past
// Vercel Authentication, and the bypass cookie once so the browser context
// carries it across subsequent navigations.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...(bypassSecret
      ? {
          extraHTTPHeaders: {
            'x-vercel-protection-bypass': bypassSecret,
            'x-vercel-set-bypass-cookie': 'true',
          },
        }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'live/**',
    },
    {
      name: 'live',
      use: { ...devices['Desktop Chrome'] },
      testMatch: 'live/**',
    },
  ],
  ...(isLocal
    ? {
        webServer: {
          command: process.env.HN_SOURCE === 'live' ? 'pnpm dev' : 'pnpm dev:e2e',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
})
