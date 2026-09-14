# Fast Playwright E2E for the Vite/React + Vercel Functions HN Summarizer

Context: reference implementation read at `main-ref/{playwright.config.ts, e2e/*, apps/api/src/enrich/model/*, .claude/rules/testing.md}`. That app was CDK/Lambda + Cognito with live HN and a `MODEL_PROVIDER` seam; this plan carries the seam forward but drops the AWS-specific auth machinery, which doesn't apply to a Vercel Functions target.

## 1. Where to mock Anthropic

**Verdict: (a) a provider seam (`MODEL_PROVIDER=fake`) for the whole e2e suite, plus a thin second layer of fixture-replay tests aimed only at the real provider's stream-parsing code.** Do not make (b)/(c) the e2e mocking strategy; keep them as an optional unit-level check.

Evidence from the reference (`apps/api/src/enrich/model/index.ts`, `fake.ts`, `anthropic.ts`):
- `getModel()` is the single seam; `fake` is picked when `MODEL_PROVIDER` is unset/`'fake'`. The comment is explicit about why: *"pnpm dev, pnpm verify and pnpm e2e need no credentials... A real key is required in exactly one place."*
- `createFakeModel().summarize()` streams deterministic chunks with `await setTimeout(env.fakeModelDelayMs)` between them — no network, no SDK, no cost — and the delay is env-tunable specifically so a Playwright test can watch incremental arrival without the suite paying seconds for it.
- The real provider (`anthropic.ts`) is a distinct module that is *not exercised at all* in `pnpm e2e`; it only runs in prod (Lambda in that repo; Vercel Functions here).

Weighing the three options:
- **(a) provider seam**: zero SDK involvement in e2e, fully deterministic, effort is minimal (one interface + one fake implementation), and it's the fastest possible path since there's no HTTP round trip at all, real or mocked. Cost: it does not exercise the real SDK's SSE parsing, `stream.finalMessage()`, or error/abort semantics — that's a real gap, but it's a gap e2e shouldn't be closing anyway (e2e is for UI/contract behavior, not SDK correctness).
- **(b) MSW/undici MockAgent replaying real SSE fixtures through the real SDK**: more realistic (proves the SDK's stream parser plus our `for await` consumption code work against Anthropic's actual wire format), but it is markedly more effort (capturing/maintaining raw SSE fixtures, keeping them in sync with SDK version and API version headers) and adds interception overhead per test. `@anthropic-ai/sdk`'s `ClientOptions` includes `fetch?: typeof fetch` (a custom fetch implementation) and `baseURL`, and Node's global `fetch`/`undici` is what MSW's `setupServer()` patches — "interception happens at the socket level, including http/https modules, the global fetch, direct Undici usage (fetch, request, pools, agents)" — and MSW node lets a handler "pass a ReadableStream directly as the reply body... forwarded as-is," which is exactly the shape needed to replay a captured Anthropic SSE stream. This is real and workable, just heavier than e2e needs.
- **(c) SDK `fetch`/`baseURL` override pointed at a tiny local mock server**: same realism/effort tradeoff as (b) but you own the mock server instead of borrowing MSW's interception layer — more code to hand-roll (a raw SSE-speaking HTTP server), no real advantage over (b) unless you specifically want to avoid a mocking library dependency.

**Recommendation**: e2e uses the provider seam exclusively (fast, zero flake risk from mocking-library edge cases, matches what the reference already proved works). Add a **second, separate unit/integration layer** — a small number of Vitest tests in `apps/api` — that exercise the *real* `anthropic.ts` provider's stream-consumption loop against 1-2 recorded Anthropic SSE fixtures via MSW (`msw/node`) or `undici` `MockAgent`, so the SDK-facing code (event filtering on `content_block_delta`/`text_delta`, `stream.finalMessage()` usage, error propagation) is verified once, cheaply, off the e2e critical path. This mirrors the reference repo's own two-layer philosophy (`.claude/rules/testing.md`: "There are two test layers and they answer different questions... Tests never touch the network").

Sources: [anthropic-sdk-typescript README](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/README.md), [helpers.md — MessageStream](https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/helpers.md), ClientOptions `fetch`/`baseURL` fields confirmed via `src/client.ts` imports and SDK docs at [platform.claude.com/docs/en/api/sdks/typescript](https://platform.claude.com/docs/en/api/sdks/typescript), [MSW node interceptors — @mswjs/interceptors](https://www.npmjs.com/package/@mswjs/interceptors), [MSW FAQ](https://mswjs.io/docs/faq/).

## 2. Should Hacker News also be mocked/fixtured in e2e?

**Verdict: yes, fixture HN for the default/CI-fast suite; keep live HN only as a separate, non-blocking "canary" run.** The reference's live-HN, structural-only design was reasonable for its goals but is incompatible with a sub-1-minute budget once you account for thread pages.

Evidence:
- The reference's own rule explains the cost it accepted: `expect: { timeout: 15_000 }` "because live HN, not a fixture, is the origin behind every assertion on a cold cache." A 15s per-assertion allowance across even a handful of thread/summary specs eats the entire 1-minute budget on one slow run.
- Thread pages there are built by one Firebase call per comment node (per `.claude/rules/hn-data.md`/`api.md` context and the enrich pipeline's node-by-node fetch), so "the busiest thread on today's front page" can mean hundreds of sequential/`Promise.all`-batched calls to `hacker-news.firebaseio.com`. Cold, over the public internet, from a GitHub Actions runner, this routinely costs several seconds to tens of seconds per page load — multiplied by however many specs open a thread (`thread.spec.ts`, `summary.spec.ts`, `smoke.spec.ts` each do). That alone can exceed a 1-minute wall-clock target even with parallelism, and it is non-deterministic (HN's front page composition, comment counts, and API latency all vary run to run), which is why the reference needed both a generous timeout and 2 CI retries — retries are themselves a tax on the 1-minute goal.
- The reference deliberately kept assertions structural ("30 story rows," "a comment that has replies") specifically *because* content is live and unstable — that's a sign the team already wanted a fixture but didn't build one for that project.

**Recommendation**: add an `HN_SOURCE=fixture` mode to the API's HN client (mirroring the `MODEL_PROVIDER` seam) that serves a handful of recorded payloads — one `topstories` list, 2-3 `item` trees (one deep/wide thread for collapse tests, one shallow one), 1 `user`, 1 Algolia search response — from local JSON, either in-process (an injectable `getItem`/`getUser`/`search` function like the vitest layer already uses, per `.claude/rules/testing.md`: "Fetching is injected... A test that supplies a map-backed `getItem`") or via a tiny local HTTP server so the real HTTP-calling code path is still exercised. In-process injection is faster and matches the existing "tests never touch the network" philosophy; a local fixture server is worth it only if you specifically want to test the HTTP client (timeouts, retries) end-to-end. Either way this turns a hundred-plus-request cold thread load into a handful of in-memory map lookups — sub-millisecond instead of seconds — and makes the front page and thread deterministic, so assertions can finally check content ("Story: <title>" appears) rather than only structure, which is strictly more valuable per test.

Capture script: a `scripts/record-hn-fixtures.ts` (Node, run manually/occasionally, not in CI) that hits live Firebase + Algolia for a chosen story id, its full comment tree, one user, and one search query, and writes verbatim JSON to `e2e/fixtures/hn/*.json` — same spirit as the reference's `docs/hn-api.md` verbatim-fixture rule ("Fixtures come from `docs/hn-api.md` verbatim... Do not invent an HN payload"). Keep fixtures honest by re-running this script periodically (e.g., a manual `pnpm hn:refresh-fixtures` before a release, or a scheduled non-blocking GH Actions job that diffs the schema, not the content, and opens an issue/fails loudly on drift) — schema drift is the actual risk, not content staleness, since assertions are structural/keyed off fixture data you control.

Keep one **separate live-HN smoke spec** (not part of the default `pnpm e2e`) that hits the real HN APIs for a basic shape check, run on a schedule or manually against a preview, so a real upstream API break is still caught — just not on every PR's 1-minute budget.

## 3. Playwright speed settings

**Verdict: fixtures + Chromium-only + `fullyParallel` + no artificial waits gets a 10-15 test suite comfortably under 1 minute on both CI and a laptop; live-HN network latency is what would blow the budget, not Playwright's own overhead.**

Key settings and evidence:
- `fullyParallel: true` — schedules individual tests to any free worker rather than pinning a whole file to one worker, so uneven file sizes (e.g., `smoke.spec.ts` vs `summary.spec.ts`) don't create a straggler.
- `workers`: default is "half of logical CPU cores." A standard GitHub-hosted `ubuntu-latest` runner is 2-core, so the useful default there is `workers: 2` (test-level parallelism still helps even with 2 cores, since Chromium is I/O/timer-bound during waits) rather than the often-repeated `workers: 1` "for stability" advice — that advice trades speed for flake-resistance on flaky/network-bound suites; once HN and Anthropic are both fixtured/faked, the suite has no real source of that flakiness, so 2 is safe and roughly halves wall time versus 1. Locally, leave `workers` undefined so it uses local core count.
- Sharding: for ~10-15 tests finishing in well under a minute already, sharding (`--shard=1/2`, matrix jobs, `blob` reporter + `merge-reports`) adds more overhead (job startup, artifact merge) than it saves. Only add sharding once the suite grows past roughly 30-40 tests or 60-90s of raw runtime.
- `webServer.reuseExistingServer: !process.env.CI` — CI always boots fresh (correctness); a laptop reuses an already-running dev server across repeated `pnpm e2e` invocations (speed).
- `retries: 0` locally (matches reference) so a genuine bug fails fast instead of being masked/slowed by retry; keep CI retries at 0 or 1, not 2 — once network non-determinism is removed via fixtures/fakes, a real CI failure is a real bug and retries mostly just delay red builds.
- Chromium only (`projects: [{ name: 'chromium', ... }]`) — matches reference; cross-browser coverage is not what a 1-minute smoke/regression suite is for.
- `expect: { timeout: <=5000 }` — can now use the framework default (5s) or even lower (2-3s), since fixtures/fakes respond in milliseconds; the reference's 15s was purely a live-HN accommodation and should be removed with it.
- Avoid `page.goto(url, { waitUntil: 'networkidle' })` — "networkIdle is by far the slowest... waits for every resource... plus 500ms of idle network time on top," and Playwright's own guidance is to assert on the specific element/state you need instead (`await expect(locator).toBeVisible()`), which is already the reference's pattern (`await expect(page.locator(story).first()).toBeVisible()` rather than waiting on load state).
- `trace: 'on-first-retry'` (matches reference) — traces only captured when something already went wrong, so passing runs pay zero overhead for them.
- Realistic scope for the budget: ~6-8 spec files, ~12-18 tests total (smoke, feeds/pagination, thread + collapse, search/user, summary/streaming states, cancellation) is what fits comfortably; each test with fixtured data should run in low hundreds of ms to ~1-2s including a `page.goto`, so 15 tests / 2 workers ≈ well under 30s of test time, leaving headroom for `webServer` boot and browser startup within the 60s wall-clock target.

Sample `playwright.config.ts` skeleton (for the report, not written into any repo):

```ts
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173'
const isLocal = !process.env.PLAYWRIGHT_BASE_URL

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
    // navigation waits happen via element assertions, not waitUntil
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(isLocal
    ? {
        webServer: {
          command: 'pnpm dev:e2e', // starts vite + api with HN_SOURCE=fixture, MODEL_PROVIDER=fake
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 30_000, // fixtures start fast; no live-HN warmup to wait on
        },
      }
    : {}),
})
```

Sources: [Playwright — Test configuration](https://playwright.dev/docs/test-configuration), [Playwright — Sharding](https://playwright.dev/docs/test-sharding), [Playwright — Continuous Integration](https://playwright.dev/docs/ci), [Why page.goto() is slowing down your Playwright tests (Checkly)](https://www.checklyhq.com/blog/why-page-goto-is-slowing-down-your-playwright-test/), [1 vCPU Linux runner GA (GitHub Changelog, confirms 2-core standard runner baseline)](https://github.blog/changelog/2026-01-22-1-vcpu-linux-runner-now-generally-available-in-github-actions/).

## 4. What should `webServer` boot?

**Verdict: Vite dev server + a plain Node process running the same Hono/Vercel-function handlers via `@hono/node-server` (or an equivalent thin Node wrapper), wired through Vite's dev proxy for `/api`.** Avoid `vercel dev` and avoid `vite preview` for the fast default suite.

Reasoning:
- `vite` dev server starts in well under a second and supports HMR, matching the reference's `pnpm dev` pattern (`command: 'pnpm dev'`).
- The Vercel Functions API code should be a set of framework-agnostic handlers (e.g., Hono, as the reference's Lambda-era API used a similar handler-per-route shape) that can be mounted two ways: under Vercel's `api/` convention for real deploys, and under `@hono/node-server` (or Node's `http.createServer`) for local dev/test — this is the same "one handler set, two runtimes" idea the reference used for `pnpm dev` vs Lambda. Vite's `server.proxy` config forwards `/api/*` to that local Node process's port, so the browser-facing origin is identical to production's same-origin `/api` calls, and Playwright only ever talks to one `baseURL`.
- `vite preview` (serving the production build) is slower to iterate (requires a build step before every server start — adds seconds per `webServer` boot, which matters when `reuseExistingServer` is false in CI) and buys nothing for behavioral correctness that the dev server doesn't already give you, since the fixtures/fakes are in the API layer, not the bundler.
- `vercel dev` is the slowest option to boot (it emulates the whole platform, cold-starts each function on first hit, and adds real overhead reproducing the Vercel routing/edge layer) and is unnecessary for behavior tests — it's the right tool for a manual pre-deploy sanity check, not for a 1-minute CI gate.

Env wiring for tests: the Node API process is started with `MODEL_PROVIDER=fake` and `HN_SOURCE=fixture` set directly in the `webServer.command` (e.g. a `pnpm dev:e2e` script that does `MODEL_PROVIDER=fake HN_SOURCE=fixture concurrently "vite" "node api-dev-server.js"`), exactly mirroring the reference's `applyLocalDefaults()` pattern where "`MODEL_PROVIDER ??= 'fake'`... keeps `pnpm dev`, `pnpm verify` and `pnpm e2e` free of credentials." Any in-memory store (e.g., a rate-limit map or a small enrichment cache) should reset per process start, which a freshly spawned `webServer` process already gives you for free — no explicit reset endpoint needed unless tests run against a long-lived `reuseExistingServer` instance and need isolation between runs, in which case add a test-only `POST /api/__test__/reset` gated behind `NODE_ENV !== 'production'`.

## 5. Running the same suite against a Vercel preview deployment

**Verdict: yes, keep a preview run, but as a small separate job/spec set, not the full suite — and never let a real Anthropic key exist on preview deployments by default.**

What changes:
- `baseURL`: set `PLAYWRIGHT_BASE_URL` to the preview URL (Vercel preview URLs, e.g. `https://<project>-<hash>-<team>.vercel.app`, or an aliased one) and the same `defineConfig` skips `webServer` entirely (`isLocal` false), matching the reference's "one config, two/three targets" design.
- Deployment protection: if Vercel's [Deployment Protection](https://vercel.com/docs/deployment-protection) is on for previews (recommended, since previews would otherwise be publicly reachable), Playwright needs the bypass token — pass `x-vercel-protection-bypass: <token>` (plus, per Vercel's docs, `x-vercel-set-bypass-cookie: true` on the first request so subsequent navigations in the same browser context carry the cookie instead of the header) as an `extraHTTPHeaders` in `use`, sourced from a CI secret. This is directly analogous to the reference's `x-id-token` exchange for its Cognito edge gate (`installSession` via `context.request`, "It must be that request object... only a context-bound one shares the cookie jar the subsequent `page.goto()` reads").
- The real Anthropic key must not be present unless the run is deliberately testing the live model: keep `MODEL_PROVIDER=fake` as the default env var on preview deployments (set in Vercel project settings for the Preview environment, distinct from Production), so a preview URL is exactly as free to hit as local/CI by default. Only a small number of manually-triggered "does the real key work" checks should ever run with a real `ANTHROPIC_API_KEY` present, and those should assert plumbing only (a 200 and a non-empty stream), never be part of routine PR CI.
- HN on preview: either keep `HN_SOURCE=fixture` on preview too (fully deterministic, zero live dependency, matches PR CI) or flip to live HN specifically for the preview run as a "does this deploy actually reach the internet" check — recommend fixture-by-default with an opt-in `HN_SOURCE=live` env toggle for an occasional manual/scheduled preview smoke.

**Recommendation on whether preview runs should exist at all**: yes, but narrow. Given Vercel preview deployments are already produced per-PR for free (no extra infra cost) and the marginal cost of hitting them with a handful of requests is negligible, a *cheap smoke* — 2-3 tests (home page loads and renders N stories from fixtures, one thread opens, health-check endpoint returns 200) run against the just-created preview URL — is worth it as a deploy-sanity gate, mirroring the reference's constrained post-deploy philosophy (`"the post-deploy run against production is pnpm e2e e2e/auth.spec.ts, not the whole suite, and that is forced"`). Running the *full* fixtured suite against preview adds no behavioral coverage beyond what the local/CI run already proved (same code, same fixtures) — it only proves "this specific deployment serves traffic," which the smoke subset already covers at much lower latency and cost.

Sources: [Vercel — Deployment Protection bypass for automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection) (protection-bypass header/cookie mechanics), reference `.claude/rules/testing.md`/`e2e/fixtures.ts` (structurally identical pattern for a different edge gate).

## 6. Deterministic streamed SSE UI states + cancellation

**Verdict: keep the reference's chunked-fake-with-a-small-delay approach; it already solves both problems and needs only a lower/tunable delay for a sub-1-minute budget.**

- Pacing: `createFakeModel()`'s `summarize()` `await`s `env.fakeModelDelayMs` between each of ~4-7 hard-coded markdown chunks before calling `onDelta`. This gives a test something genuinely incremental to observe (assert the summary element has partial content, then assert it later has more/different content, or assert an intermediate `data-state="streaming"` before `data-state="complete"`) without needing real model latency. For a 1-minute suite, keep `FAKE_MODEL_DELAY_MS` very small in the test env (e.g. 10-20ms rather than a human-perceptible value) — enough for two `await`s to land as observably separate microtask/timer ticks that Playwright's auto-retrying assertions can catch, but not enough to cost real wall-clock time across every test that touches summaries. Only bump it up (e.g. 200-500ms) for one deliberate "watch it stream" test if you want a visually-obvious incremental-render assertion; the rest can rely on state-attribute assertions (`data-state`) which don't care about timing.
- Determinism: `fakeSummary(input)` is a pure function of the input text (thread title regex + comment-line count + character count), so re-running the same fixture thread produces byte-identical summary output — this is what lets a test assert on `data-state` transitions and even on partial content shape without flakiness, and is why the reference calls it out as enabling "two runs over the same thread produce the same `inputKey` -> same stored row."
- Cancellation: the reference's `summary.spec.ts` test ("navigating away mid-stream leaves no error behind") is the right shape — click the request button, assert the button/loading state started, then immediately `page.goto('/')` before the stream can finish, and assert the app is simply back on the list page with no dangling error UI. This exercises the real thing that matters: the frontend's `fetch`/`AbortController` cleanup on unmount, and the backend's handling of a client disconnect mid-SSE-write (which, with `onDelta` awaited per the `Model` interface's own doc comment — "not awaiting it would let the model outrun the socket" — should throw/reject naturally when the underlying response stream closes, and that rejection should be caught and swallowed rather than logged as a crash). No extra timing tricks are needed for this test since it only needs the stream to have *started*, not to be at any particular percentage through.

## 7. GitHub Actions workflow shape

**Verdict: one job, no sharding, sequential steps (lint/typecheck → unit → e2e), Chromium-only browser install, and skip caching the browser binary itself — this fits well inside ~3 minutes given a fixtured/faked e2e layer.**

Evidence and reasoning:
- The reference's `ci.yml` is already close to this shape: single `ubuntu-latest` job, `pnpm install --frozen-lockfile` → `pnpm verify` (lint/typecheck/unit) → `pnpm exec playwright install --with-deps chromium` → `pnpm e2e`, with `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` so superseded pushes don't waste runner time. Carry that structure forward.
- Browser caching: Playwright's own CI docs explicitly advise against it — *"Caching browser binaries is not recommended, since the amount of time it takes to restore the cache is comparable to the time it takes to download the binaries."* `pnpm exec playwright install --with-deps chromium` (Chromium only, not all three engines) is fast enough on its own that a cache step would add complexity without a clear win; if it's still measured as a bottleneck later, cache keyed on the exact Playwright version pinned to `~/.cache/ms-playwright`.
- Sharding: skip it. Sharding's overhead (extra job scheduling/startup, a merge-reports step) is not worth it below roughly a minute of actual test time, and per section 3 this suite should land around there. Revisit only if the suite later grows substantially.
- Budget breakdown for "~3 minutes total": checkout + `setup-node`/pnpm cache restore (~15-20s) + `pnpm install --frozen-lockfile` (~15-30s with a warm pnpm store cache) + `pnpm verify` (lint+typecheck+unit, likely 20-40s for a small repo) + `playwright install --with-deps chromium` (~20-40s, mostly `apt` deps) + `pnpm e2e` (well under 60s per section 3) comfortably totals under 3 minutes; the biggest lever if it runs long is caching the pnpm store (`actions/setup-node`'s built-in `cache: pnpm`, already in the reference's `setup-node` step) rather than anything Playwright-specific.
- Keep the `verify` job independent of any deploy/preview workflow (as the reference does — "Runs in parallel with the preview deploy in pr-preview.yml rather than waiting on it") so PR feedback isn't gated on Vercel's own deploy time.

Sources: [Playwright — Continuous Integration / GitHub Actions](https://playwright.dev/docs/ci), reference `.github/workflows/ci.yml`.

## Recommendations (summary)

1. Keep the `MODEL_PROVIDER` seam (`fake` for all local/CI/e2e runs); add it never touches the network. Add a small Vitest layer replaying real Anthropic SSE fixtures through the real SDK (MSW or `undici` MockAgent) as a separate, non-e2e check on the provider module only.
2. Add an `HN_SOURCE=fixture` seam analogous to `MODEL_PROVIDER`; capture fixtures with a manual recording script into `e2e/fixtures/hn/*.json`; keep one non-blocking live-HN canary spec outside the default suite.
3. `fullyParallel: true`, `workers: 2` on CI / default locally, Chromium only, `expect.timeout` at or below the 5s default, `trace: 'on-first-retry'`, no `networkidle` waits, ~12-18 tests total, no sharding yet.
4. `webServer` boots Vite dev + a Node-hosted copy of the same Vercel-function handlers via a dev proxy, with `MODEL_PROVIDER=fake HN_SOURCE=fixture` baked into the `webServer.command`.
5. Keep a preview run, but only a 2-3 test smoke gated by the Vercel protection-bypass header/cookie, with `MODEL_PROVIDER=fake` as preview's default env (no real key present unless a deliberate, separate, manually-triggered check).
6. Keep the reference's chunked deterministic fake with a small, env-tunable inter-chunk delay; assert `data-state` transitions rather than timing; test cancellation via immediate navigation mid-stream.
7. One CI job, sequential lint/typecheck/unit/e2e, no browser-binary caching, no sharding, pnpm-store caching via `setup-node`.

## Open questions / risks

- **Fixture staleness vs. HN schema drift**: fixtures never going stale in content is fine (that's the point), but if HN's Firebase/Algolia response *shape* changes upstream, fixtured tests won't catch it. Mitigate with the periodic live-HN canary (section 2), not by making the fast suite live.
- **In-process HN fixture injection vs. a local fixture HTTP server**: this report recommends in-process injection for speed/simplicity; if the team wants the HTTP client code itself under test (retry/timeout behavior), a local fixture server is the better choice but adds a bit of `webServer`-array complexity.
- **Vercel Preview Protection specifics** (bypass header vs. cookie exchange, and whether it's Standard or a paid-tier feature) should be confirmed against the team's actual Vercel plan before wiring CI secrets — verify current mechanics at [vercel.com/docs/deployment-protection](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection) at implementation time, since protection bypass configuration has changed across Vercel plan tiers historically.
- **`workers: 2` on a 2-core CI runner**: validate empirically once the real suite exists — if Chromium's own CPU usage under load makes 2 workers slower than 1 due to contention, drop back to 1; this is a tuning decision to make with real numbers, not from docs alone.
- **Where the "same handler code, two runtimes" boundary lives** (Hono vs. raw Vercel `api/*.ts` functions vs. something else) wasn't specified by the user; this report assumes a framework-agnostic handler layer is a design goal (mirroring the reference's Lambda/dev split) — confirm that's still the intended API architecture before committing to the `@hono/node-server` local-dev approach in section 4.
