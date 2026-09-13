---
paths:
  - "e2e/**"
  - "**/*.test.ts"
  - "playwright.config.ts"
  - "vitest.config.ts"
---

# Tests

Loaded when you touch a vitest test, the Playwright config, or anything under `e2e/`.

There are two test layers and they answer different questions.

## vitest — `server/hn`, `server/hn/fixture`, `server/app.test.ts`

The tree merge, sibling ordering, the node cap, `200 + null` handling, and tombstoned children
are the only real logic in `server/hn`, and they are pure — that is why it gets a test framework
and most of this repo does not. `server/app.test.ts` earns the same treatment for cache headers
and error mapping.

- **Tests never touch the network.** Fetching is injected, so a test supplies a map-backed
  `getItem` instead of stubbing `fetch`. A test that would fail on a plane is a bug.
- Fixtures come from `docs/hn-api.md` verbatim, or from `e2e/fixtures/hn/*.json` for anything
  recorded. Do not invent an HN payload; if you need a shape neither has, say so.
- Assert against `StorySchema.parse` / `CommentSchema.parse`, not hand-written object literals,
  so a normalizer that drifts from the contract fails here, not in the browser.

## Playwright

`fullyParallel`, `workers: CI ? 2 : undefined`, `retries: CI ? 1 : 0`, `expect.timeout: 5000`.
Two projects: `chromium` (the whole suite except `e2e/live/**`) and `live` (only `e2e/live/**`,
against real HN). `TARGET` is `local` (no `PLAYWRIGHT_BASE_URL`) or `remote` (set) — there is no
auth and no per-target credential in this epoch.

- **`HN_SOURCE=fixture` is the seam, not a mock server.** `pnpm dev:e2e` and the `chromium`
  project run the real HN clients, normalizers, and tree walk — only `server/hn/http.ts`'s
  `fetchJson` is swapped for a fixture-file reader. An unrecorded URL throws `UpstreamError`
  naming it, surfacing as a 502; that means a missing fixture, not a bug in the walk.
- **Write the spec before the UI it covers.** The `data-testid` set becomes a contract the
  component is built against — that is why specs survive a component rewrite untouched.
- **Assertions are structural, never content-based**, even against fixtures: "30 rows, each with
  a title" is testable; "the top story is X" is not, and it will drift the next time a fixture is
  re-recorded.
- **Do not assert on a locator whose filter depends on the state under test** — it re-resolves on
  every assertion and can silently start matching a different element. Resolve to a fixed
  attribute selector (e.g. `data-comment-id`) first, then assert.
- **Assert the accessible state, not the styling hook** — collapse via `aria-expanded`, not a
  class or `hidden`. Boolean `data-*` is for CSS; an ARIA state is the better test contract.
- Three specs are tagged `@smoke` (rows render, a thread opens, `/api/health` is 200) — that
  subset is what a preview-deploy check runs, so keep it fast and dependency-free.
- **The suite has a one-minute budget.** If a run exceeds it, fix the cause — a slow wait, a
  stray live call — never the timeouts.
- **`pnpm e2e -- e2e/x.spec.ts` does not filter** — the `--` is swallowed and the whole suite
  runs. `pnpm e2e e2e/x.spec.ts` is the form that works.
- When `VERCEL_AUTOMATION_BYPASS_SECRET` is set, `playwright.config.ts` sends the bypass header
  and `x-vercel-set-bypass-cookie: true` automatically — see `.claude/rules/vercel.md`. A spec
  itself never needs to know about it.
