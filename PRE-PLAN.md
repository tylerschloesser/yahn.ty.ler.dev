# PRE-PLAN: yahn.ty.ler.dev on Vercel

This file is the input to `PLAN.md`. It records the decisions already made, the research behind
them, the target architecture, what to salvage from `main`, and how the plan itself must be
shaped. It was assembled on 2026-09-13 by one Opus session that delegated research to six
sub-agents; their full reports are in `docs/research/` and are cited below as `[hosting]`,
`[jobs]`, `[e2e]`, `[client]`, `[salvage]`, `[context]`.

Read this whole file before writing `PLAN.md`. `PROMPT.md` is the original brief and still wins
where the two disagree.

## 1. How to turn this into PLAN.md

- **`PLAN.md` is the plan for the *next single Opus manager session*, not the whole roadmap.**
  Section 9 splits the work into epochs sized for one session each. `PLAN.md` covers exactly one
  epoch, names the epochs it leaves for later, and is regenerated from this file plus the repo's
  state when that epoch is done.
- **Every chunk in `PLAN.md` carries a one-line acceptance check** that someone with no
  conversation context can run (a command, a grep, a Playwright spec name). No check, no chunk.
- **Delegate as much as possible to Sonnet sub-agents.** The manager decomposes, decides, and
  reviews the integrated diff; `implementer` (Sonnet) types; a *different* `verifier` (Sonnet)
  runs the check and reports PASS/FAIL without fixing. Section 8 defines those agents. The manager
  should not read source files an implementer can summarize for it.
- **Prefer big mechanical chunks.** Most of Epoch 1 is copying files from `main` with named
  edits; one implementer can port a whole directory if the chunk lists the edits.
- **Spikes before commitments.** Section 10 lists things that must be measured or verified on a
  real Vercel deployment before the code that depends on them is written. `PLAN.md` schedules
  them first.
- **Write the e2e spec before the UI it covers.** The `data-testid` contract in `[salvage] §4`
  already exists; reuse it.
- Sub-agents do not see the manager's conversation. Every delegation prompt must be
  self-contained: the chunk, the check, the rule file to read, the files to touch.

## 2. Fixed inputs (from PROMPT.md)

- Vite + React SPA (already scaffolded on this branch), CSS Modules, Base UI 1.8.0, simple CSS
  tokens with a colour palette, TanStack Router and Query.
- Backend on Vercel with two jobs: abstract the HN Firebase and Algolia APIs for the SPA, and
  manage Jobs for long async AI tasks. Basic CDN caching. Some storage for jobs.
- Copy the HN UX as closely as possible; the product is the AI features.
- Anthropic key from the environment. Playwright e2e with the Anthropic layer mocked, whole suite
  under one minute including parallelism.
- Small `CLAUDE.md` with per-domain context files. Plans delegate to Sonnet sub-agents and are
  scoped to one Opus manager session.
- After Vercel is live, tear down AWS. No data migration.

## 3. Decisions made in this pre-plan

Each is a recommendation the plan should treat as settled unless a spike in section 10
contradicts it. Rationale is one line; the cited report has the evidence.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Single package, no pnpm workspace, no catalog.** Vite app at the repo root, `api/` for the Vercel entry, `server/` for the Hono app and everything behind it, `shared/` for the zod schema. | One Vercel project, no Root Directory or build-skip config, one lockfile. `[hosting] §7` |
| D2 | **One Hono app, one Vercel Function.** Read routes and streaming routes live in the same app. | The Lambda-era split existed only because response streaming was a per-Function-URL property. On Fluid compute it is not. `[hosting] §1–2`, `[salvage] §3` |
| D3 | **Local dev and e2e run the same Hono app under `@hono/node-server` on a fixed port, with Vite's `server.proxy` forwarding `/api`.** `vercel dev` is not in the loop. | Fastest boot, no emulation layer, identical app file in both runtimes. `[hosting] §5`, `[e2e] §4` |
| D4 | **Storage is Upstash Redis via the Vercel Marketplace**, one instance for enrichment results, job records and locks. `STORE=memory` (a `Map`) when no Redis URL is set. | Native TTL, sorted sets for "newest usable summary", `SET NX EX` for dedup, real free tier. Vercel KV is dead. `[jobs] §2, §4` |
| D5 | **Jobs run inside the request that creates them, on Fluid compute, with `waitUntil` guarding the persistence tail.** No Workflows, Queues or QStash in v1. | Default `maxDuration` is 300s on every plan; a summary takes 10–60s. Workflows are the upgrade path if fact-checking needs multi-step retries. `[jobs] §1, §6` |
| D6 | **Model: `claude-opus-5`, `thinking: { type: 'adaptive' }`, `output_config: { effort: 'low' }`, `max_tokens` 16000, streamed.** Model id and effort are env-overridable. | Carries the measured main-branch choice; low effort minimises time-to-first-token on a non-intelligence-sensitive task. Sonnet 5 ($2/$10 per MTok vs $5/$25) is the user's call, see U3. |
| D7 | **Provider seam `MODEL_PROVIDER=fake\|anthropic`** with the deterministic chunked fake reused from `main`. e2e never talks to Anthropic. | Already proven; zero cost, zero flake. `[e2e] §1` |
| D8 | **HN is also fixtured in e2e: `HN_SOURCE=fixture\|live`.** Recorded payloads in `e2e/fixtures/hn/`, captured by a script, served in-process. One non-blocking live-HN canary spec outside the default suite. | A cold live thread is hundreds of Firebase requests; the one-minute budget is impossible against live HN. `[e2e] §2` |
| D9 | **Playwright: Chromium only, `fullyParallel`, `workers: 2` on CI, `expect.timeout` ≤ 5s, `retries` 0 locally / 1 on CI, no sharding, ~12–18 tests.** | Fits the budget with headroom once D7 and D8 remove network latency. `[e2e] §3, §7` |
| D10 | **Caching: the origin sets `Cache-Control` after the upstream call resolves; feeds `s-maxage=30, stale-while-revalidate=300`, items `s-maxage=60`; every non-2xx and every job/stream route sends `no-store`.** Add `Vercel-Cache-Tag` per feed and item so a purge is possible. | Vercel honours `s-maxage`/`swr`, never caches 4xx/5xx, keys on the full URL. Streamed responses *are* cacheable unless told otherwise. `[hosting] §3`, `[jobs] §3` |
| D11 | **Node 24 runtime**, pinned in project settings and `engines`. | Vercel's default for new projects; Node 20 is removed 2026-10-01. `[hosting] §1` |
| D12 | **TypeScript stays on 6.x; Vitest 4.x.** | `@css-modules-kit/ts-plugin` is a language-service plugin and TS 7's plugin surface is unstable until 7.1. `[client] §1, §5` |
| D13 | **Client patterns unchanged from `main`:** `createRootRouteWithContext`, `ensureQueryData` in loaders, `useSuspenseQuery` in components, `defaultPreloadStaleTime: 0`, committed `routeTree.gen.ts`, hand-rolled SSE reader over `fetch` (not `EventSource`, not `streamedQuery`), `refetchInterval` as a function for job polling. | All still the documented recommendation. `[client] §2–3` |
| D14 | **CSS tokens: one hand-written `tokens.css`** with HN's literal palette (`#ff6600`, `#f6f6ef`, `#828282`, `#000`) plus a dark set, a 4px space scale, a tight type scale, two radii. No Radix Colors. Keep stylelint with the css-modules plugin and the "no literal colours or px in `*.module.css`" rule. | PROMPT.md asks for *simple* tokens and a faithful HN look; the two-layer Radix system was neither. `[client] §5–6` has the token inventory if the plan wants it. |
| D15 | **No auth code in the app.** Access control, if any, is Vercel Deployment Protection (see U1). Spend control is in the API regardless (section 5.6). | Cognito and the edge gate were the bulk of the AWS complexity. `[salvage] §1` |
| D16 | **Vercel git integration deploys everything**: production from `main`, a preview per PR. GitHub Actions runs only `pnpm verify` and `pnpm e2e`, plus a 2–3 test smoke against the preview URL using the protection-bypass header. | Four AWS workflows collapse to one. `[hosting] §4`, `[e2e] §5` |
| D17 | **`ANTHROPIC_API_KEY` is a Sensitive env var scoped to Production only.** Preview and Development run `MODEL_PROVIDER=fake`. | Previews and tests structurally cannot spend money. `[jobs] §5` |
| D18 | **Same tooling conventions as `main`**: oxlint with `jsx-a11y` at error, stylelint, css-modules-kit codegen, no formatter, no semicolons, single quotes, `erasableSyntaxOnly` + `verbatimModuleSyntax`, `pnpm verify` = lint + typecheck + test + build. | Proven; every rule file assumes them. `[salvage] §6` |

## 4. Decisions left to the user

The plan should state the assumption it proceeds under; these do not block Epoch 1.

| # | Question | Recommendation |
| --- | --- | --- |
| U1 | **Who can reach the site?** Without the edge gate, anyone can trigger a paid summary. Options: (a) public, relying on section 5.6 spend caps; (b) Vercel Deployment Protection with Vercel Authentication on *all* deployments (free on Hobby, owner and team only, zero code); (c) public read paths, protected job creation via a shared secret. | **(b) for v1**, plus the spend caps in all cases. Confirm in the dashboard that "All Deployments" covers the custom domain. |
| U2 | **Vercel plan.** Hobby is non-commercial only, one region, 300s max duration, 4 active-CPU-hours a month included. | Hobby, since this is personal. Watch active CPU once summaries are frequent. `[hosting] §6` |
| U3 | **Model.** `claude-opus-5` as before, or `claude-sonnet-5` at roughly 40% of the cost. | Keep Opus; the env override makes switching a one-line change. |
| U4 | **Job observation model.** Section 5.4 proposes a durable job (create, poll, attach to stream) so a viewer can leave and return. The simpler alternative is the `main` design: the request streams and persists at the end, no job record. | The durable job model, because PROMPT.md names Jobs as a backend responsibility. Spike S3 decides if the Redis tail is clean enough. |
| U5 | **Which AI features after thread summary, and in what order.** Candidates: article summary, reader mode (extracted article text), fact-check of a comment against the article. | Article summary next (section 9, Epoch 3); it reuses the whole job pipeline and the enrichment slot. |
| U6 | **Keep `hybrid` comment source?** `main` kept an Algolia-tree fallback behind `COMMENT_SOURCE=hybrid`. | Port it; it is tested and free. Default stays `firebase`. |

## 5. Target architecture

### 5.1 Repository layout

```
api/index.ts                Vercel Function entry: exports the Hono app (adapter per spike S1)
server/app.ts               createApp(): routes, zod validation, cache headers, error mapping
server/dev.ts               @hono/node-server on :3001 for pnpm dev and Playwright
server/env.ts               lazy env getters + applyLocalDefaults() (MODEL_PROVIDER, STORE, HN_SOURCE)
server/hn/**                ported packages/hn (firebase, algolia, tree, feed, normalize, tests)
server/hn/fixture/**        HN_SOURCE=fixture source reading e2e/fixtures/hn/*.json
server/enrich/**            thread.ts, prompt.ts, model/{index,anthropic,fake}.ts, usable()
server/jobs/**              job records, lock, runner, SSE writer
server/store/**             Store interface, redis.ts (Upstash), memory.ts
shared/schema/**            ported packages/schema (zod, looseObject everywhere) + job schemas
src/**                      ported apps/web/src (routes, components, styles, lib)
e2e/**                      specs, fixtures.ts (target detection only), fixtures/hn/*.json
scripts/record-hn-fixtures.ts, scripts/ordering-spike.mjs
docs/hn-api.md              copied verbatim from main
docs/research/*.md          the six reports behind this file
vercel.json, playwright.config.ts, vitest.config.ts, tsconfig*.json
.claude/**, CLAUDE.md       section 8
```

`vercel.json` needs the SPA rewrite `/(.*)` to `/index.html`; the filesystem and Functions take
precedence over rewrites, so `/api/*` is never swallowed. Whether the catch-all API route needs
its own rewrite or a `[[...route]].ts` filename is spike S1.

### 5.2 Read API (ported, same contract as main minus auth)

```
GET /api/health
GET /api/v1/feeds/:feed?page=1        feed ∈ top|new|best|ask|show|job     s-maxage=30, swr=300
GET /api/v1/items/:id                                                     s-maxage=60, swr=300
GET /api/v1/items/:id/enrichments     stored, usable enrichments for the item   s-maxage=15
GET /api/v1/users/:id                                                     s-maxage=60
GET /api/v1/search?q=&page=&sort=relevance|date                           s-maxage=60
```

Error mapping is a contract: missing item → 404, upstream failure → 502 never 500, every
non-2xx → `no-store`. Headers are set after the `await`, never before.

### 5.3 HN data layer

Ported unchanged except for env: Firebase is authoritative and ordered, Algolia is one request
per tree and the only search, `kids` order is never sorted, tombstones are tolerated,
`descendants` is passed through. BFS walk with concurrency 128 and node cap 2000, both env
tunable. The node cap and the worst-case wall time must be re-measured on Vercel (spike S2):
`main` saw a 27s outlier through Lambda; 300s is the ceiling here, not 30s, so this is likely fine
but must be seen, not assumed.

### 5.4 Jobs

```
POST /api/v1/jobs                     { kind: 'thread-summary', itemId, strategy?, budget? }
   200 { job: { id, state: 'complete', result } }   a usable stored result existed; no model call
   202 { job: { id, state: 'running' } }            started now, or already running (dedup)
GET  /api/v1/jobs/:id                 { job }  state ∈ running|complete|error     no-store
GET  /api/v1/jobs/:id/events          SSE: meta, delta*, then exactly one complete|error   no-store
```

- **Lifecycle.** `POST` renders the input (tree walk), computes `inputKey`, checks the store with
  the `usable()` rule (below). Miss: `SET lock:{kind}:{itemId} {jobId} NX EX 120`. Winner writes
  `job:{id}` = running, starts the model call, appends each delta to `job:{id}:deltas`, and on
  completion writes the enrichment row, marks the job complete, releases the lock; all of that
  runs under `waitUntil` so a client that navigates away does not cancel it. Loser reads the lock
  value and returns 202 with the running job's id.
- **`events`** replays `job:{id}:deltas` from the start, then tails by polling Redis every
  ~300–500ms until the job leaves `running`. `meta` is sent before the first Redis read so the
  first byte is immediate; a `: keepalive` comment every 15s. The client treats a stream that ends
  without a terminal event as an error.
- **Store keys** (Redis; the memory store mirrors them):

  ```
  enrich:{itemId}:{kind}                zset  score=generatedAt  member=inputKey
  enrich:{itemId}:{kind}:{inputKey}     json  { text, model, generatedAt, inputKey, input, usage }   no TTL
  job:{id}                              json  { id, kind, itemId, state, startedAt, error?, inputKey? }   EX 3600
  job:{id}:deltas                       list  text chunks                                              EX 3600
  lock:{kind}:{itemId}                  str   jobId                                                     EX 120
  ```
- **`usable()` rule, ported verbatim from `main`'s `store.ts`:** newest first, a stored row is
  reused only if the thread has not grown more than 15% since it was written *and* it covered at
  least 85% as many comments as this request would (or the same strategy and budget). Both halves
  were each caught by measurement; neither is optional. `[salvage] §3`.
- **Schemas** for job records and the SSE events live in `shared/schema/` because producer and
  consumer drift invisibly otherwise. The `Enrichments` slot on every item stays optional and
  loose.

### 5.5 Model layer

`getModel()` returns `fake` unless `MODEL_PROVIDER=anthropic`. The Anthropic implementation is
`main`'s `anthropic.ts` with the Secrets Manager fetch replaced by `process.env.ANTHROPIC_API_KEY`:
`client.messages.stream({...})`, forward `content_block_delta`/`text_delta`, `await onDelta` per
chunk (never fire-and-forget), `stream.finalMessage()` for billed usage. The prompt in
`main`'s `prompt.ts` is the product and is copied verbatim. Thread rendering (`thread.ts`:
`budget` strategy, 200k-char cap, BFS admission then tree-order render, tombstone splice) is pure
and copied with its tests.

### 5.6 Spend control (independent of U1)

- `DAILY_BUDGET_USD`: a Redis counter `spend:{yyyy-mm-dd}` incremented with the cost computed
  from billed usage; `POST /jobs` refuses with 429 when the day's total exceeds the cap.
- Per-client limit on job creation (Upstash `@upstash/ratelimit` or a plain `INCR`/`EX`).
- The fake provider bills `null`, never `0`, so it cannot dilute the counter.

### 5.7 Environment variables

| Variable | Local default | Production |
| --- | --- | --- |
| `MODEL_PROVIDER` | `fake` | `anthropic` |
| `ANTHROPIC_API_KEY` | unset | Sensitive, Production only |
| `MODEL`, `MODEL_EFFORT` | `claude-opus-5`, `low` | same |
| `STORE` | `memory` | `redis` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (names per the marketplace integration) | unset | injected |
| `HN_SOURCE` | `live` for `pnpm dev`, `fixture` for `pnpm e2e` | `live` |
| `COMMENT_SOURCE`, `HN_TREE_CONCURRENCY`, `HN_TREE_NODE_CAP` | `firebase`, 128, 2000 | same until S2 says otherwise |
| `DAILY_BUDGET_USD` | unset (no cap) | set |
| `FAKE_MODEL_DELAY_MS` | 20 | n/a |

## 6. Salvage map (from main; full table in `[salvage] §1`)

**Reuse as-is:** `packages/hn/src/**` and its 7 test files; `packages/schema/src/**` except
`MeResponse`; `apps/api/src/enrich/{thread,thread.test,prompt}.ts`, `model/{index,fake}.ts`,
`store.ts`'s `usable()` and memory store, `store.test.ts`; the SSE event contract in
`enrich-stream.ts`; `apps/web/src/{lib/**, feeds.ts, main.tsx, router.tsx, queryClient.ts,
routes/** except __root's AuthMenu, components/** except AuthMenu, index.html's dark-mode
script}`; `e2e/{smoke,feeds,search-and-user,thread,summary}.spec.ts`; `docs/hn-api.md`;
`scripts/ordering-spike.mjs`; `.oxlintrc.json`, `stylelint.config.js` (minus Radix
`importFrom`), tsconfig flags, `ci.yml`, `claude.yml`.

**Adapt:** `app.ts` (drop `getAuthUser`, `/me`; fold the enrich app's SSE writer and heartbeat
into the jobs routes); `env.ts` (drop `AUTH`, `AWS_REGION`, secret id); `server.ts` → `dev.ts`
(one port); `model/anthropic.ts` (env key); `store.ts` (Redis instead of DynamoDB);
`api.ts` and `ThreadSummary` (plain `fetch` instead of `apiFetch`; job create/poll/attach instead
of one GET stream); `queries.ts` (drop config/me); `e2e/fixtures.ts` (keep target detection,
delete auth); `pnpm-workspace.yaml` (gone; versions move to `package.json`).

**Drop:** `auth.ts`, `lambda*.ts`, `AuthMenu/**`, `auth.spec.ts`, `scripts/preview-login.sh`,
`infra/cdk/**`, `deploy.yml`, `pr-preview.yml`, `pr-teardown.yml`, `cleanup.yml`,
`.claude/rules/{auth,cdk}.md`, all `@aws-sdk/*`, `@tylerschloesser/cdk-core`, `aws-cdk*`.

**Testids to keep as the contract:** `nav-link`, `search-input`, `feed-title`, `story`,
`story-rank/title/score/author/comments`, `page-prev/next/status`, `thread-summary`
(`data-state` idle|streaming|complete|error), `thread-summary-request/text/meta/error`,
`comment` (`data-comment-id`, `data-tombstone`), `comment-toggle` (`aria-expanded`),
`comment-author`, `search-heading/empty`, `user-karma/created`, `author-filter`, `author-item`
(`data-kind`). Boolean `data-*` is `""` when true and absent when false.

## 7. Testing strategy

- **vitest** for `server/hn/**`, `server/enrich/**`, `server/store/**` (memory) and
  `server/jobs/**` (memory store, fake model): the tree merge, ordering, node cap, tombstones,
  thread rendering, the `usable()` rule, the job state machine. Never the network; fetch is
  injected. Fixtures come from `docs/hn-api.md` and `e2e/fixtures/hn/`.
- **One small vitest file** exercising the real `anthropic.ts` against a recorded Anthropic SSE
  fixture through MSW or undici `MockAgent`, so the SDK-facing loop is verified once, off the e2e
  path. `[e2e] §1`
- **Playwright** default suite: `HN_SOURCE=fixture MODEL_PROVIDER=fake STORE=memory`, config per
  D9, `webServer` runs `pnpm dev:e2e` (Vite + `server/dev.ts`). Specs: smoke, feeds and
  pagination, thread and collapse and the `/item?id=` redirect, search and user, summary (not
  auto-requested; request reaches `complete`; second viewer attaches to a running job; navigating
  away mid-stream leaves no error; a stored summary is served without a model call).
  Fixture set: one `topstories`-shaped list per feed (30+ ids, so page 2 exists), two threads (one
  deep with a tombstone, one shallow), one user, one search response, one empty search.
- **Canary:** `e2e/live/hn.spec.ts` against live HN with structural assertions, excluded from the
  default project, run manually or on a schedule.
- **CI:** one job, `pnpm install` → `pnpm verify` → `playwright install --with-deps chromium` →
  `pnpm e2e`; pnpm store cached via `setup-node`, no browser cache, no sharding. Target under
  three minutes. A second job runs the 2–3 test preview smoke once Vercel reports the preview
  URL, with `x-vercel-protection-bypass` and `x-vercel-set-bypass-cookie` headers. `[e2e] §5, §7`

## 8. Context management for the new repo

- **`CLAUDE.md` under 100 lines**: what the project is, the layout, `pnpm verify`/`dev`/`e2e`,
  the "always true" list (no credentials locally, headers after await, loose schemas, committed
  route tree, conventions), the rules table, and the delegation contract from section 1. Point
  at `docs/hn-api.md` as the canonical HN reference and forbid re-deriving it.
- **`.claude/rules/*.md` with `paths:` frontmatter**, each under ~120 lines, loaded when a
  matching file is read (so sub-agents are told to read the relevant one *first*):

  | Rule | `paths` | Holds |
  | --- | --- | --- |
  | `web-ui.md` | `src/**`, `index.html`, `vite.config.ts`, `stylelint.config.js` | tokens, CSS Modules, Base UI (check docs, `@base-ui/react/*`, `.root { isolation: isolate }`, `body { position: relative }`), `data-*` convention, Query-owns-cache, route tree gotcha |
  | `api.md` | `api/**`, `server/app.ts`, `server/routes/**`, `shared/schema/**` | thin handlers, zod at the boundary, error mapping, cache headers after await, `no-store` rules, `looseObject` |
  | `hn-data.md` | `server/hn/**` | the two APIs, ordering finding, invariants, concurrency numbers with their Vercel re-measurement |
  | `ai-jobs.md` | `server/enrich/**`, `server/jobs/**`, `server/store/**` | provider seam, prompt ownership, `usable()` rule and why both halves, job lifecycle, key scheme, spend caps, `waitUntil` bound |
  | `testing.md` | `e2e/**`, `**/*.test.ts`, `playwright.config.ts`, `vitest.config.ts` | fixtures not live, spec-first, structural assertions, locator pitfalls, the one-minute budget and what to do when it is blown |
  | `vercel.md` | `vercel.json`, `.github/workflows/**`, `server/dev.ts` | function entry and adapter, env var scoping, preview bypass, the CDN rules that differ from CloudFront, how to purge by tag |

  Seed each rule from `[salvage] §8`, the list of AWS-independent lessons, and from the
  corresponding `main` rule (`git show main:.claude/rules/<name>.md`).
- **Agents** (`.claude/agents/`, all `model: sonnet`): `implementer` (Read, Edit, Write, Bash,
  Grep, Glob; runs `pnpm verify` before reporting; never commits), `verifier` (Read, Grep, Glob,
  Bash; reports PASS/FAIL/UNVERIFIABLE with evidence; never edits), `researcher` (Read, Grep,
  Glob, WebFetch, WebSearch; read-only; for "check the current docs for X" questions). Port the
  `main` agent bodies; add `maxTurns` (30 is a reasonable start) so a stuck agent stops and
  reports.
- **Skills:** port `file-issue`. Add `record-hn-fixtures` (runs the capture script, diffs
  schema, `disable-model-invocation: true`).
- **Hooks:** one `PreToolUse` hook on `Edit|Write` that refuses `src/routeTree.gen.ts` and
  `generated/**`. Do not add a typecheck-on-every-edit hook; it slows implementers and
  `pnpm verify` already gates the report.
- **`.claude/settings.json`:** allow `pnpm verify|lint|typecheck|test|build|e2e*|install|exec *`,
  `git status|diff|log|show|ls-files|branch`, `gh pr|issue|run` reads, `vercel env pull`,
  `vercel inspect`, `vercel ls`, `curl -sS http://localhost:5173/*` and `:3001/*`, and the
  Vercel preview and production hosts. Nothing destructive; no `vercel --prod`, no `aws`.
- **Memory/plan files:** `PRE-PLAN.md` (this), `PLAN.md` (current epoch), `docs/research/`.
  After a compaction the manager re-reads `PLAN.md`, not the research.

## 9. Epochs (one Opus manager session each)

**Epoch 1 — Foundation and the read-only clone.** Exit: `https://<project>.vercel.app` serves
the six feeds, item threads with collapse, user pages and search from live HN; `pnpm verify` and
`pnpm e2e` pass in under a minute against fixtures; CI green; `CLAUDE.md` and rules exist.
Chunks, roughly in order: spikes S1 and S2 (section 10); repo skeleton and tooling (D1, D11, D12,
D18, `pnpm verify`); port `shared/schema`; port `server/hn` with tests; Hono app with read routes,
cache headers, error mapping, `server/dev.ts`, Vite proxy; fixture source and capture script;
e2e specs (spec-first) and Playwright config; port web routes, components, tokens (D14), styles;
`vercel.json`, first deploy, GitHub integration, CI; context files.

**Epoch 2 — Jobs and the thread summary.** Exit: the item page offers "summarize", streams a
summary from a durable job, a second tab attaches to the same job, a stored summary is reused
under the `usable()` rule, spend caps refuse over budget, all under `MODEL_PROVIDER=fake` in e2e
and against the real model in production. Chunks: spike S3; store interface, memory and Redis
implementations with tests; port `enrich/` and model seam; job routes and SSE; `usable()` and the
enrichments endpoint; web `ThreadSummary` on the job model; Redis marketplace provisioning and
env vars; spend caps; e2e summary spec; rules `ai-jobs.md`.

**Epoch 3 — Domain cutover and AWS teardown, then article summary.** Exit: `yahn.ty.ler.dev`
points at Vercel (U1 answered); every item in section 11 is gone, with the "must not delete" list
respected; the article-summary job kind exists end to end. The teardown is a short scripted
checklist a human runs with the manager watching; it is not delegated to an implementer.
Article summary: server-side fetch and extraction of the linked URL (or the Anthropic `web_fetch`
server tool, which avoids writing an extractor; researcher checks availability and cost), keyed on
the story's `contentKey`, same job pipeline.

**Later:** reader mode, fact-check, Workflows if a multi-step job appears.

## 10. Spikes and risks (schedule these first)

| # | Question | How to answer | Blocks |
| --- | --- | --- | --- |
| S1 | Exact Vercel entry for a Hono catch-all next to a Vite SPA: `api/index.ts` with `hono/vercel`'s `handle`, or a Web-standard default export, or `api/[[...route]].ts`; and whether an `/api/(.*)` rewrite is needed. | Deploy a two-route Hono app plus the Vite scaffold to a throwaway project; confirm `/api/health` and `/` and a deep SPA link. Also confirm `s-maxage` headers show `x-vercel-cache: HIT` on a repeat. | Epoch 1 |
| S2 | Wall time and memory of the 128-concurrency Firebase walk on a Vercel function for a 1,500-node thread; whether outbound connection limits bite. | Ten interleaved cache-busted requests through the deployed function; record median and max. Adjust `HN_TREE_NODE_CAP`/concurrency if the max nears 60s. | Epoch 1 rule numbers |
| S3 | `waitUntil` keeps a job running after the `POST` returns and after the client disconnects; behaviour of `@vercel/functions` `waitUntil` under `@hono/node-server` locally (no-op vs throw); Redis tail latency and command count per viewer. | Small job that sleeps 20s writing ticks to Redis; observe from a second request. | Epoch 2, U4 |
| S4 | Marketplace Upstash env var names and region; free-tier command budget vs the polling design (~2 commands/s per attached viewer). | Provision, read the injected vars, compute. | Epoch 2 |
| S5 | Deployment Protection "All Deployments" covers the custom domain on Hobby, and the bypass header works from GitHub Actions. | Dashboard plus one curl. | U1, Epoch 3 |
| R1 | TS 7 / css-modules-kit incompatibility. | Hold TS 6.x (D12); re-check when 7.1 ships. | — |
| R2 | Streamed responses are CDN-cacheable by default on Vercel. | `no-store` on every job and events route; a test asserts the header. | — |
| R3 | HN fixture schema drift. | Canary spec plus the capture script's schema diff. | — |
| R4 | Fluid compute bills active CPU; the BFS walk is I/O-bound but 128 concurrent JSON parses are not free. | Read the usage dashboard after S2. | U2 |

## 11. AWS teardown inventory (condensed from `[salvage] §7`)

Account `063257577013`, `us-east-1`. **Never delete:** the `ty.ler.dev` hosted zone, the GitHub
OIDC provider (owned by thai.ler.dev's stack), secret `cdk-core/google-oauth`, anything named
`ThaiLerDev*` or `CdkCore*`. Re-verify the ACM validation CNAME's owner before touching it.

Delete, in this order, after the domain cutover: any `Yahn-pr-<n>` stacks → `YahnSite` (then the
RETAINed `EnrichTable` and its two log groups explicitly) → `YahnPreview` → `YahnShared` (the
certificate) → `YahnGithubOidc` (the `yahn-github-deploy` role only) → secrets
`yahn-ty-ler-dev/anthropic`, `yahn.ty.ler.dev/preview-machine-user`,
`yahn.ty.ler.dev/preview-session-secret` → leaked `/aws/lambda/Yahn-pr-*` log groups → SSM
params under the yahn prefix → Route53 records for `yahn.ty.ler.dev` and
`*.preview.yahn.ty.ler.dev` that still point at CloudFront → GitHub variable
`AWS_DEPLOY_ROLE_ARN`. Keep `CLAUDE_CODE_OAUTH_TOKEN` and the Claude App secrets.

## 12. Reference

**Versions (npm, 2026-09-13, `[client] §1`):** react 19.3, vite 8.3, @vitejs/plugin-react 6.1,
@tanstack/react-router 1.170, @tanstack/router-plugin 1.168, @tanstack/react-query 5.102,
@base-ui/react 1.8.0, zod 4.6, typescript 6.0.x (hold), vitest 4.x (hold), @playwright/test 1.63,
@anthropic-ai/sdk 0.125, hono 4.13, @hono/node-server 2.x, @vercel/functions latest,
@upstash/redis latest, oxlint 1.82, stylelint 17.15, @css-modules-kit/* 1.4.

**Anthropic API notes:** adaptive thinking only (`budget_tokens` is a 400 on Opus 5); effort
levels `low|medium|high|xhigh|max` under `output_config`; streaming with
`client.messages.stream` and `finalMessage()` for usage; no assistant prefill; the system prompt
is far below the prompt-caching minimum, so caching does not apply here. Pricing per MTok:
Opus 5 $5 in / $25 out, Sonnet 5 $2 / $10, Haiku 4.5 $1 / $5.

**Vercel facts the plan relies on (`[hosting]`, `[jobs]`):** Fluid compute default; 300s default
and Hobby max `maxDuration`; Web-standard `Request`/`Response` handlers; `waitUntil` from
`@vercel/functions` bounded by the same `maxDuration`; CDN caches only 200/404/410/30x, keys on
method + full URL + host + deployment, honours `s-maxage` and `stale-while-revalidate`, purges by
`Vercel-Cache-Tag`; per-region cache; env vars scoped Production/Preview/Development with
Sensitive write-only values; preview protection bypass via `x-vercel-protection-bypass`.

**Research index:** `docs/research/vercel-hosting.md`, `vercel-jobs-and-storage.md`,
`e2e-testing.md`, `client-stack.md`, `main-branch-salvage.md`, `claude-code-context.md` (read
its caveat first). The previous implementation is on `main`; read files with
`git show main:<path>` rather than checking it out into the working tree.
