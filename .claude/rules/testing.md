---
paths:
  - "e2e/**"
  - "**/*.test.ts"
  - "playwright.config.ts"
  - "packages/hn/vitest.config.ts"
  - "apps/api/vitest.config.ts"
---

# Tests

Loaded when you touch a vitest test, the Playwright config, or anything under `e2e/`.

There are two test layers and they answer different questions.

## vitest, `packages/hn` and `apps/api/src/enrich`

The tree merge, sibling ordering, the node cap, `200 + null` handling and tombstoned children
are the only real logic in `packages/hn`, and they are pure. That is why it has a test framework
and most of this repo does not — not as a coverage target, but because it gives a subagent a
fast, cheap, offline feedback loop on the one thing that can be subtly wrong. `apps/api/src/enrich`
earns the same treatment for the same reason: thread rendering (selection strategy, tombstone
splicing, HTML-to-text, the BFS-then-tree-order budget walk) is pure and exactly the kind of
subtly-wrong logic this rule exists to protect, even though it lives inside `apps/api`.

- **Tests never touch the network.** Fetching is injected, so a test supplies a map-backed
  `getItem` instead of stubbing `globalThis.fetch`. A test that would fail on a plane is a bug.
- Fixtures come from `docs/hn-api.md` **verbatim** — the README's `item/8863`, the live-captured
  deleted and dead tombstones. Do not invent an HN payload; if you need a shape the document
  does not have, say so rather than guessing at it.
- Assert against `StorySchema.parse` / `CommentSchema.parse`, not against hand-written object
  literals, so a normalizer that drifts from the contract fails here rather than in the browser.

## Playwright, four specs

`smoke.spec.ts` (the vertical slice), `feeds.spec.ts` (the six feeds and pagination),
`search-and-user.spec.ts`, `thread.spec.ts` (collapse, the `/item?id=` redirect, bylines).
Split by area rather than by page so a failure names the thing that broke.

- **Write the spec before the UI it covers.** Epoch 1 did this and it is why its specs survived
  a component rewrite: the `data-testid` set was a contract the components were built against,
  not a description of what they happened to render. Epoch 3 did the same for all three new
  files. A spec written afterwards tests the implementation; a spec written first tests the
  intent.
- **Assertions are structural, never content-based.** The specs run against live Hacker News,
  whose front page changes under the test. "30 story rows render, each with a title, a score and
  a comment count; clicking the first shows a comment tree" is testable. "The top story is X" is
  not, and a test that asserts it will fail for someone else, tomorrow, for no reason.
- **One config, two targets.** With `PLAYWRIGHT_BASE_URL` unset, `playwright.config.ts` boots
  `pnpm dev` itself via `webServer` and tests `localhost`. Set it — `PLAYWRIGHT_BASE_URL=https://pr-123.yahn.ty.ler.dev pnpm e2e` — and the identical spec runs against a
  deployed preview with no server of its own. Keep any new spec runnable both ways; anything
  that only works locally belongs in vitest instead.
- **You rarely need to run the preview target by hand: `pr-preview.yml` already does**, after a
  gate that waits for `/api/health`. Previews live at `pr-<N>.preview.yahn.ty.ler.dev` behind a
  permanent wildcard record, so a stale NXDOMAIN in your resolver is no longer the failure mode;
  a 404 right after a deploy is the preview router not yet knowing the hostname (a KeyValueStore
  write reaching the edge). Wait for the gate, or re-run it. See `.claude/rules/cdk.md`.
- **`pnpm e2e -- e2e/x.spec.ts` does not filter** — the `--` is swallowed and the whole suite
  runs. `pnpm e2e e2e/x.spec.ts` is the form that works.
- `expect.timeout` is raised above Playwright's default because live HN, not a fixture, is the
  origin behind every assertion on a cold cache.
- **Do not assert on a locator whose filter depends on the state under test.** `thread.spec.ts`
  needs "a comment that has replies", but collapsing it is exactly what stops it matching that
  filter, and a Playwright locator re-resolves on every assertion — so it would silently start
  pointing at a different comment. Resolve such a thing to a fixed selector first
  (`data-comment-id`), then assert.
- **Assert the accessible state, not the styling hook.** Collapse is checked through the
  trigger's `aria-expanded`, so the test does not care whether the replies are unmounted or
  merely hidden. Boolean `data-*` attributes are for CSS; where an ARIA state exists it is the
  better contract.
