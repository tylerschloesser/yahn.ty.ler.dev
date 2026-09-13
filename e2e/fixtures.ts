import { test as base, expect } from '@playwright/test'

/**
 * There is no auth and no per-target credential this epoch — this file only
 * detects which of the two targets a run is against, and re-exports `test`
 * through `base.extend` so a later chunk can add a fixture here without
 * every spec's import changing.
 *
 * - **local** (`PLAYWRIGHT_BASE_URL` unset): `playwright.config.ts` boots
 *   `pnpm dev:e2e` itself, `HN_SOURCE=fixture`. The recorded manifest in
 *   `e2e/fixtures/hn/manifest.json` (see `./hn-fixture.ts`) describes exactly
 *   what is being served, which is what makes the assertions gated on
 *   `TARGET === 'local'` safe to write against specific ids.
 * - **remote** (`PLAYWRIGHT_BASE_URL` set): a deployed URL. The identical
 *   spec runs against it with no server of its own.
 */
export type Target = 'local' | 'remote'

function detectTarget(): Target {
  return process.env.PLAYWRIGHT_BASE_URL ? 'remote' : 'local'
}

export const TARGET = detectTarget()

export const test = base.extend({})

export { expect }
