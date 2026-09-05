---
paths:
  - "e2e/**"
  - "**/*.test.ts"
  - "playwright.config.ts"
  - "packages/hn/vitest.config.ts"
---

# Tests

Loaded when you touch a vitest test, the Playwright config, or anything under `e2e/`.

There are two test layers and they answer different questions.

## vitest, `packages/hn` only

The tree merge, sibling ordering, the node cap, `200 + null` handling and tombstoned children
are the only real logic in this repo, and they are pure. That is why `packages/hn` has a test
framework and nothing else does — not as a coverage target, but because it gives a subagent a
fast, cheap, offline feedback loop on the one thing that can be subtly wrong.

- **Tests never touch the network.** Fetching is injected, so a test supplies a map-backed
  `getItem` instead of stubbing `globalThis.fetch`. A test that would fail on a plane is a bug.
- Fixtures come from `docs/hn-api.md` **verbatim** — the README's `item/8863`, the live-captured
  deleted and dead tombstones. Do not invent an HN payload; if you need a shape the document
  does not have, say so rather than guessing at it.
- Assert against `StorySchema.parse` / `CommentSchema.parse`, not against hand-written object
  literals, so a normalizer that drifts from the contract fails here rather than in the browser.

## Playwright, one spec

- **Assertions are structural, never content-based.** The specs run against live Hacker News,
  whose front page changes under the test. "30 story rows render, each with a title, a score and
  a comment count; clicking the first shows a comment tree" is testable. "The top story is X" is
  not, and a test that asserts it will fail for someone else, tomorrow, for no reason.
- **One config, two targets.** With `PLAYWRIGHT_BASE_URL` unset, `playwright.config.ts` boots
  `pnpm dev` itself via `webServer` and tests `localhost`. Set it — `PLAYWRIGHT_BASE_URL=https://pr-123.yahn.ty.ler.dev pnpm e2e` — and the identical spec runs against a
  deployed preview with no server of its own. Keep any new spec runnable both ways; anything
  that only works locally belongs in vitest instead.
- `expect.timeout` is raised above Playwright's default because live HN, not a fixture, is the
  origin behind every assertion on a cold cache.
