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

## Playwright, six specs

`smoke.spec.ts` (the vertical slice), `feeds.spec.ts` (the six feeds and pagination),
`search-and-user.spec.ts`, `thread.spec.ts` (collapse, the `/item?id=` redirect, bylines),
`summary.spec.ts`, `auth.spec.ts`. Split by area rather than by page so a failure names the
thing that broke.

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
  `pnpm dev` itself via `webServer` and tests `localhost`. Set it —
  `PLAYWRIGHT_BASE_URL=https://pr-123.preview.yahn.ty.ler.dev pnpm e2e` — and the identical spec
  runs against a deployed preview with no server of its own. Keep any new spec runnable both
  ways; anything that only works locally belongs in vitest instead.
- **Auth makes it three targets**, and `e2e/fixtures.ts` derives them from that same variable:
  `local` (unset), `preview` (a `pr-<n>.preview.…` host) and `prod` (anything else). Everything
  target-specific lives in a fixture or in a `test.skip(TARGET === 'prod', …)` at **declaration**
  scope — never a branch inside a test body, and never an in-body skip: Playwright resolves a
  test's fixtures before running the body, so `machineAuth` would already have thrown. That
  fixture throws loudly on `prod` rather than yielding a useless token, because **prod has no
  machine identity by design** and a spec reaching for one there has forgotten its skip. The
  assertion that earns the whole arrangement is the negative one: a *preview* token sent to
  production must be 401 — and with the edge gate that assertion moved to
  `GET https://yahn.ty.ler.dev/auth/session`, because `/api/v1/me` is now answered by a
  **redirect at the edge** before the origin is reached. `/auth/*` is the one ungated path, so it
  is the only place a token still gets as far as the prod verifier. See `.claude/rules/auth.md`.
- **The gate changes how a session is seeded, and `page.addInitScript` no longer works
  deployed.** An init script runs once a page has loaded, and a gated navigation never reaches a
  page. So `authedPage` branches: `local` keeps seeding `localStorage['cdkcore:auth']` (there is
  no gate in `pnpm dev`), while `preview` calls `GET /auth/session` with `x-id-token` through
  **`page.context().request`** and lets the response's `Set-Cookie` land in the context's jar.
  It must be that request object and not a standalone `request.newContext()`: only a context-
  bound one shares the cookie jar the subsequent `page.goto()` reads, and the standalone form
  fails as a redirect loop rather than as anything that names the cause.
- **Every spec imports `test` from `./fixtures.js`, never from `@playwright/test`.** That is the
  only way the extended `page` fixture reaches them, and off local it is what gets them past the
  edge gate: the `page` fixture installs the machine session cookie on `preview`, so a plain
  `page.goto('/')` reaches the app instead of a 302 to Cognito. Five specs still imported
  Playwright's `test` directly when the gate landed, and every one of them failed against the
  preview while passing locally — the import looks harmless and the failure names the app, not
  the import. `local` is deliberately left unauthenticated (no gate exists there, and
  `auth.spec.ts` needs a signed-out page for the dev-login box), and a spec that wants a
  cookie-less context on preview builds one with `browser.newContext()`.
- **The post-deploy run against production is `pnpm e2e e2e/auth.spec.ts`, not the whole suite,
  and that is forced.** Every other spec drives the app through a signed-in `page`, and prod has
  **no machine identity by design**, so there is no credential CI could sign in with. What is
  left does prove something real — the 302 to the hosted UI means the distribution, the
  CloudFront Function and the KVS secret are all live — but origin health on prod is now covered
  by the PR preview run before merge, not after it. Do not "fix" this by giving the prod pool a
  machine user; that is the thing `auth.md` calls structurally impossible on purpose.
- **A health-gate `curl` must check the status code, not lean on `curl -f`.** Behind the gate
  `/api/health` answers **302** to an anonymous poller, and `-f` only fails on >= 400 — so both
  workflows' wait loops read the redirect as success and silently stopped gating anything. They
  now compare `%{http_code}`: on preview "not 404" means the router resolved the host (a missing
  KVS key is a 404), on prod a 302 or 200 means the distribution answered.
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
