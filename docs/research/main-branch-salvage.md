# yahn.ty.ler.dev → Vercel Rebuild: Reuse Audit

Source: read-only checkout of the AWS/CDK version at `main-ref`. All paths are repo-relative.

## 1. Salvage table

### `packages/hn/src/*` — zero AWS/Cognito/cdk-core imports anywhere in this package

| Path | What it does | Verdict | AWS/Cognito coupling |
|---|---|---|---|
| `index.ts` | Barrel export | REUSE as-is | none |
| `env.ts` | Lazy `process.env` getters: `COMMENT_SOURCE`, `HN_TREE_CONCURRENCY` (128), `HN_TREE_NODE_CAP` (2000), timeouts | REUSE as-is | none |
| `errors.ts` | `NotFoundError`, `UpstreamError` | REUSE as-is | none |
| `http.ts` | Single `fetchJson` entrypoint, global `fetch`, retry+backoff+jitter on 429/5xx, 304 short-circuit | REUSE as-is | none |
| `pool.ts` | `mapWithConcurrency` — dependency-free bounded-concurrency mapper | REUSE as-is | none |
| `host.ts` | Strip `www.`, lowercase host for display | REUSE as-is | none |
| `content-key.ts` | `sha256(url ?? text).slice(0,16)` | REUSE as-is | none |
| `item.ts` | `getItem(id)` → `getCommentSource()` | REUSE as-is | none |
| `feed.ts` | Feed id list fetch, page-count-from-list-length, per-page item fetch | ADAPT — re-tune `HN_TREE_CONCURRENCY` against Vercel's `maxDuration`, logic unchanged | none |
| `search.ts` | Algolia story search wrapper | REUSE as-is | none |
| `author.ts` | Algolia author-history wrapper | REUSE as-is | none |
| `user.ts` | Firebase user fetch | REUSE as-is | none |
| `normalize.ts` | Firebase/Algolia raw → `Story`/`Comment`/`AuthorItem`, computes `contentKey` | REUSE as-is | none |
| `algolia/client.ts`, `algolia/types.ts` | Algolia HTTP calls + zod shapes | REUSE as-is | none |
| `firebase/client.ts` (+ `types.ts`) | Firebase HTTP calls; module-level ETag/`If-None-Match` cache `Map` | REUSE as-is — the in-memory ETag cache is per-process state that just degrades to lower hit rate on less-warm Vercel instances, doesn't break | none |
| `tree/index.ts` | `getCommentSource()` lazy seam (`firebase` default / `hybrid`) | REUSE as-is | none |
| `tree/firebase.ts` | BFS walk, concurrency 128, node cap 2000, truncation, tombstone tolerance | REUSE as-is; **tune concurrency/node-cap against Vercel duration limit** (see §2) | none |
| `tree/hybrid.ts` | Algolia whole-tree + Firebase-`kids` top-level reorder, node cap | REUSE as-is | none |
| `*.test.ts` (7 files: host, content-key, author, feed, normalize, tree/firebase, tree/hybrid) | Pure offline vitest, map-backed fetch injection, fixtures verbatim from `docs/hn-api.md` | REUSE as-is | none |

### `packages/schema/src/*`

| Path | What it does | Verdict | AWS coupling |
|---|---|---|---|
| `index.ts` | Barrel | REUSE as-is | none |
| `item.ts` | `Story`/`Comment`/`User`/`AuthorItem` — all `z.looseObject` | REUSE as-is | none |
| `feed.ts` | `FeedName`, `FeedResponse`, `PAGE_SIZE=30` | REUSE as-is | none |
| `response.ts` | `ItemResponse`, `SearchResponse`, `AuthorItemsResponse`, `MeResponse`, `ErrorResponse` | ADAPT — drop `MeResponseSchema` (the one auth-shaped remnant) | none |
| `enrichment.ts` | `EnrichmentKind`, `EnrichmentInput`, `ThreadSummary`, `Enrichments` slot | REUSE as-is | none (comment mentions the DynamoDB sort key, but schema itself is store-agnostic) |
| `enrich-stream.ts` | SSE contract: `EnrichMeta/Delta/Complete/ErrorSchema`, `ENRICH_EVENT` | REUSE as-is | none |

### `apps/api/src/*`

| Path | What it does | Verdict | AWS/Cognito coupling |
|---|---|---|---|
| `app.ts` | Hono read API: routing, `zValidator`, cache headers, error mapping | ADAPT — strip the `getAuthUser`/`user` context var and `/api/v1/me`; port the Hono app into Vercel Functions (one catch-all function running the same Hono `app.fetch`, which Hono supports natively, is the least-diff path) | imports `./auth.ts` |
| `auth.ts` | `getAuthUser(c)` → `@tylerschloesser/cdk-core/auth/server` | **DROP** entirely | hard `@tylerschloesser/cdk-core` import |
| `env.ts` | Lazy env getters incl. `AUTH` local default, `anthropicSecretId`, `STORE`/`MODEL_PROVIDER`, `fakeModelDelayMs` | ADAPT — drop `AUTH`; replace `anthropicSecretId` (Secrets Manager id) with plain `ANTHROPIC_API_KEY`; keep the `STORE`/`MODEL_PROVIDER` seam pattern verbatim | `AWS_REGION` const, `anthropicSecretId` |
| `lambda.ts` | `handle(createApp())` | **DROP** (Lambda-only adapter) | `hono/aws-lambda` |
| `lambda-enrich.ts` | `streamHandle(createEnrichApp())` | **DROP** the adapter; replace with a Vercel Function returning a `Response` with a `ReadableStream` body — `createEnrichApp()` itself (the Hono app) is portable | `hono/aws-lambda streamHandle` |
| `server.ts` | Local dev composition root, two ports (3001/3002) | ADAPT — drop the `AUTH=local` line in `applyLocalDefaults()`; the two-port split (read vs. streaming) is a real, worth-keeping local-dev mirror of the two-Function production split | none directly |
| `enrich/thread.ts` | Rendering: `full`/`top-level`/`budget` strategies, BFS-admission-then-tree-order render, HTML→text, tombstone splice | **REUSE as-is** — pure, no I/O | none |
| `enrich/thread.test.ts` | Offline vitest | REUSE as-is | none |
| `enrich/prompt.ts` | System + user prompt templates | **REUSE as-is verbatim** — this is the product | none |
| `enrich/model/index.ts` | `getModel()` seam, `fake` default via `applyLocalDefaults()` | REUSE as-is | none |
| `enrich/model/anthropic.ts` | Real streaming call | ADAPT — replace `SecretsManagerClient`/`GetSecretValueCommand` with `process.env.ANTHROPIC_API_KEY`; the `client.messages.stream(...)` call itself is unchanged | **`@aws-sdk/client-secrets-manager`** — isolated to one function, `create()` |
| `enrich/model/fake.ts` | Deterministic, delay-chunked fake streaming model, bills `null` tokens | **REUSE as-is** — exactly the mocked-Anthropic layer the rebuild needs | none |
| `enrich/store.ts` | DynamoDB key scheme + 15%-growth/coverage reuse rule (`usable()`) | ADAPT — rewrite `createDynamoStore()`'s `QueryCommand`/`PutCommand` against Redis (sorted set/hash) or Postgres (indexed table, `ORDER BY generated_at DESC LIMIT 10`); `usable()`, `pk()`/`sk()`, `createMemoryStore()` are pure and port untouched | **`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`** — isolated to `createDynamoStore()` |
| `enrich/store.test.ts` | Offline vitest against `STORE=memory` | REUSE as-is | none |
| `enrich/app.ts` | Second Hono app: SSE route, serialized `writer()`, 15s heartbeat, `cheapRead()` | ADAPT — streaming glue → Vercel Function `ReadableStream`; internal route logic, event sequencing, and `cheapRead()` are framework-agnostic and port near-verbatim | none directly (depends on `store.ts`/`model/*`) |

### `apps/web/src/*` by route/component

| Path | What it does | Verdict | AWS/Cognito coupling |
|---|---|---|---|
| `index.html` | Inline pre-paint dark-mode script (`prefers-color-scheme` → `.dark` on `<html>`) | REUSE as-is | none |
| `main.tsx`, `router.tsx`, `queryClient.ts` | React root, router instance, Query defaults (`staleTime:30s`, `retry:1`) | REUSE as-is | none |
| `queries.ts` | `queryOptions` for feed/item/search/user/authorItems + `configQueryOptions`/`meQueryOptions` | ADAPT — drop `configQueryOptions`/`meQueryOptions` | `loadConfig` from cdk-core |
| `api.ts` | Typed fetchers over `getJson`, 1-based↔0-based page conversion | ADAPT — swap `apiFetch` import for a plain same-origin `fetch`; drop `fetchMe` | `@tylerschloesser/cdk-core/auth/browser` `apiFetch` |
| `feeds.ts`, `lib/sse.ts`, `lib/html.ts`, `lib/time.ts` | Feed table; SSE frame parser; HTML sanitizer; `timeAgo`/`pluralize` | **REUSE as-is** — `lib/sse.ts` especially: framework-agnostic parser over any `fetch` `Response.body`, drops into a Vercel Function's streamed SSE unchanged | none |
| `routes/__root.tsx` | Shell/nav/search | ADAPT — drop `<AuthMenu/>` | via AuthMenu only |
| `routes/index.tsx`,`ask`,`best`,`newest`,`show`,`jobs.tsx` | Six feed routes over `FeedPage` | REUSE as-is | none |
| `routes/item.$id.tsx`, `item.index.tsx` | Item page composition; `/item?id=` HN-URL-compat redirect | REUSE as-is | none |
| `routes/search.tsx`, `user.$id.tsx` | Search page; user profile + history | REUSE as-is | none |
| `routeTree.gen.ts` | Generated, **committed** route tree | REUSE the mechanism (regenerate via Vite, keep committing it) | none |
| `components/AuthMenu/*` | Sign-in/out UI, dev-login form | **DROP** — no one-line justification found for keeping it | `apiFetch`, `login`/`logout`, `loadConfig`, all cdk-core |
| `components/AuthorHistory`, `Boundary`, `CommentTree`, `FeedPage`, `Pagination`, `StoryHeader`, `StoryList`, `UserProfile` | Presentational + `CommentTree`'s recursive Base UI `Collapsible` | **REUSE as-is** | none |
| `components/ThreadSummary/*` | SSE-driven summary state machine (idle/streaming/complete/error) | ADAPT — one-line swap of `apiFetch` for plain `fetch`; state machine and SSE consumption unchanged | `apiFetch` import only |
| `styles/*.css` (tokens/primitives/base/global/reset) | Two-layer token system, Radix Colors | **REUSE as-is** | none |

### `e2e/*`

| Path | What it does | Verdict | AWS/Cognito coupling |
|---|---|---|---|
| `fixtures.ts` | `TARGET` (local/preview/prod) detection, Cognito machine-login AWS CLI calls, `/auth/session` cookie install | ADAPT heavily — delete all auth machinery; **keep** the `test.extend`/target-detection pattern | `execFileSync('aws', ['secretsmanager'/'cognito-idp', ...])`, `/auth/session`, `__Host-cdkcore-session` cookie |
| `smoke.spec.ts`, `feeds.spec.ts`, `search-and-user.spec.ts`, `thread.spec.ts` | Structural specs against live HN | REUSE as-is once `fixtures.ts` is de-authed | none directly |
| `summary.spec.ts` | AI-summary SSE state assertions, runs against `MODEL_PROVIDER=fake` | **REUSE as-is** — already the model for "e2e with a mocked Anthropic layer" | none |
| `auth.spec.ts` | Cognito two-pool isolation, edge-gate 302, dev-login round trip (6 tests) | **DROP** entirely — no post-auth equivalent | entirely Cognito/CloudFront-shaped |

### Everything else

| Path | What it does | Verdict | Coupling |
|---|---|---|---|
| `docs/hn-api.md` | Canonical mined HN API reference (fields, tombstones, latencies, ordering finding) | **REUSE as-is verbatim** — upstream API knowledge, platform-independent | none |
| `scripts/ordering-spike.mjs` | Re-runnable proof that Algolia orders `children` chronologically, not by rank | REUSE as-is | none |
| `scripts/preview-login.sh` | Mints a Cognito session cookie for curl against a preview | **DROP** | entirely Cognito/edge-gate specific |
| `.oxlintrc.json` | oxlint config, `jsx-a11y` at `correctness:error`, per-dir overrides | REUSE as-is | none |
| `stylelint.config.js`, `.stylelintignore` | Two-layer token enforcement, a11y + css-modules-kit plugins | REUSE as-is | none |
| `tsconfig.base.json`/`tsconfig.json`/`tsconfig.e2e.json` + per-package configs | `erasableSyntaxOnly`/`verbatimModuleSyntax`, solution-file references | ADAPT — drop the `infra/cdk` reference from root `tsconfig.json` | none otherwise |
| root `package.json` | `pnpm verify` composition, catalog devDeps | REUSE structure as-is | none |
| `pnpm-workspace.yaml` catalog | Version pins | ADAPT — drop `@tylerschloesser/cdk-core`, `aws-cdk-lib`, `aws-cdk`, `constructs`; drop `@aws-sdk/client-secrets-manager` and (if moving off Dynamo) `@aws-sdk/client-dynamodb`/`lib-dynamodb`; keep everything else, including the `@anthropic-ai/sdk` pin | removal targets identified explicitly |
| `infra/cdk/**` | Whole 5-stack CDK app (`bin/app.ts`, context, package.json) | **DROP** entirely | wholesale `aws-cdk-lib`, `@tylerschloesser/cdk-core` |
| `.github/workflows/ci.yml` | PR verify + e2e | REUSE as-is — no AWS coupling in this file | none |
| `.github/workflows/claude.yml` | Claude Code GitHub Action, `@claude` trigger | REUSE as-is | none |
| `.github/workflows/deploy.yml`, `pr-preview.yml`, `pr-teardown.yml`, `cleanup.yml` | CDK deploy / per-PR preview / teardown / daily sweep | **DROP** — Vercel's own git-integration deploy/preview/teardown replaces all four | `aws-actions/configure-aws-credentials`, `cdk deploy`, `delete-stack`, `cdk-core sweep` |

---

## 2. The HN data layer (`packages/hn`)

**Two upstreams, one seam.** Firebase (`hacker-news.firebaseio.com/v0`) is authoritative — live `score`/`descendants`, `kids` in HN's real ranked order — but has no batch endpoint (one HTTP GET per item; a front page plus every tree measured 4,636 requests). Algolia returns a whole nested tree in one request (0.33s/41KB vs. 72 Firebase requests for the same thread) and is the only search option, but lags indexing, reports `points: null` on comments, caps at 1,000 hits, and — measured by `scripts/ordering-spike.mjs` against live threads, 195/195 multi-child arrays — nests `children` **strictly ascending by id at every depth**, i.e. chronological, not ranked. `getCommentSource()` (`tree/index.ts`) is a lazy singleton picking `firebaseSource()` (default) or `hybridSource()` via `COMMENT_SOURCE`.

**The BFS walk** (`tree/firebase.ts`): each frontier is fetched via `mapWithConcurrency(frontier, 128, getItem)` into a flat `Map<id, item>`; the next frontier is every resolved node's own `kids`. A node cap (default 2000) stops descent mid-level and sets `truncated: true` rather than erroring. Sibling order comes from a **second pass** — `buildChildren()` recursively walks each node's original `kids` array against the resolved map — so final order is exactly HN's `kids` order regardless of arbitrary BFS resolution order. Concurrency 128 was chosen from a single-machine sweep (24→5.2s, 64→2.4s, **128→1.6s**, 192→1.5s, flat past 128) that returned identical node sets at every concurrency — purely a throughput knob. Through the deployed Lambda it bought only ~30% (5.4–7.5s → 4.06s median, range 3.69–4.88s, **one 27s outlier** against a 30s Lambda timeout), because Lambda's path to Firebase dominates over local fan-out speed.

**Tombstones.** `deleted`/`dead` only ever appear `true`; a deleted item loses `by`/`text`/`kids` but its id still appears in its *parent's* `kids`. The walk tolerates this natively — a tombstone has no `kids` of its own, so recursion just ends there; a kid fetch failure is caught and silently dropped rather than failing the whole tree.

**`contentKey`**: `sha256(url ?? text ?? '').slice(0,16)`, computed in `normalize.ts` for every `Story`/`Comment`/`AuthorItem`. It's content identity — fixed the moment an item is posted — explicitly *not* what a thread summary should key on (comments arriving don't change it; see §3).

**Feed pagination** (`feed.ts`): fetches the full id list, computes `pageCount = ceil(total/30)` from the list *as fetched* (observed lengths vary — 500/500/200/55/137/31 for top/new/best/ask/show/job — never hardcoded), fetches the page's ~30 items concurrently, drops per-item failures rather than failing the page.

**Retries/`http.ts`**: one `fetchJson` entrypoint on global `fetch` (no custom agent — Firebase only speaks HTTP/1.1, so there's no h2 multiplexing to lean on anyway); exponential backoff+jitter on 429/5xx, up to 2 retries; a 304 short-circuits before JSON parse; failures map to exactly `NotFoundError`/`UpstreamError`.

**Vitest coverage**: 7 pure, offline test files. Fetching is always injected as a parameter (map-backed `getItem`/`getStoryIds`), never a `globalThis.fetch` stub. Fixtures are lifted verbatim from `docs/hn-api.md` (the exact `item/8863` object, captured deleted/dead tombstones), and results are asserted through `StorySchema.parse`/`CommentSchema.parse` so a normalizer drifting from the zod contract fails here, not in the browser.

**Lambda-specific?** Nothing in the code — no `aws-lambda`/`@aws-sdk/*`/`cdk-core` import anywhere in this package, and `env.ts` reads plain `process.env` with no Lambda-only defaults. The only Lambda-shaped fact is *external*: the 128-concurrency default and the 27s worst case were tuned against Lambda's specific outbound path and its 30s/512MB config.

**Is 128-way BFS a problem on Vercel?** Memory is a non-issue (a few MB for ≤2000 resolved items plus 128 in-flight requests). Outbound connections are probably fine (Node's fetch/undici pools connections; 128 simultaneous sockets to one host is well short of platform fd limits, though a cold instance firing 128 new TLS handshakes at once is worth re-measuring rather than assuming). **Duration is the real risk**: Vercel Functions' default/Hobby-tier timeout is far below Lambda's 30s, and even a Pro-tier `maxDuration` extended toward 60s only barely covers the observed 27s worst case with no margin. This is the one number that should gate a go/no-go — either lower `HN_TREE_NODE_CAP`, explicitly set `maxDuration` near the platform ceiling for the item route, or move the largest threads to an incremental/streamed response so a client sees progress before a hard function timeout kills it.

---

## 3. The enrichment/AI layer (`apps/api/src/enrich/*`)

**`thread.ts` — rendering.** Three `SelectionStrategy` values: `full` (every non-tombstoned comment, tree-order DFS via `collect()`), `top-level` (depth-0 only), `budget` (default cap 40,000 chars locally / **200,000 chars** as the production default set in `enrich/app.ts`, overridable via `?budget=`). `selectBudget()` does a **separate BFS admission pass** (all of depth 0, then depth 1, …) accumulating rendered-line length and stopping the instant the running total would exceed the cap — it never skips ahead to squeeze in a smaller later comment, and a non-empty thread always admits at least one comment even if it alone blows the budget. `collect()` then re-renders the admitted set in tree order, since BFS-admission-order and DFS-render-order are different passes. Tombstones are spliced out by `buildTree()`: a tombstone contributes no line but its children are promoted to render **at the tombstone's own depth**, not one level deeper. `htmlToText()` is regex/string-based (no DOMParser in Node) — `<p>`/`<br>` become paragraph/line breaks, everything else stripped to inner text, with `&amp;` decoded **last** so a literal `&amp;lt;` survives as `&lt;` rather than becoming `<`.

**`prompt.ts` — verbatim.**

System prompt (`SUMMARY_SYSTEM`):
> You summarize Hacker News comment threads for a reader who has not read them.
>
> Write in GitHub-flavored markdown. Structure the summary as:
>
> - A short opening paragraph — two or three sentences — saying what the thread is actually about, which is often not what the story is about.
> - A "## Main points" section: a handful of bullets, each naming a distinct claim, argument or piece of experience that several commenters engaged with. Attribute a view to "commenters" or "one commenter", never to a username.
> - A "## Disagreements" section, only if the thread genuinely contains one. Say what each side holds. If the thread is broadly in agreement, omit this section entirely rather than manufacturing a dispute.
>
> Rules:
>
> - Summarize only what is in the input. Do not add background, correct the commenters, or supply facts the thread does not contain.
> - Prefer the substantive and the specific over the popular. A single detailed comment can matter more than ten agreeing one-liners.
> - Do not open with "This thread discusses" or restate the story title as a first line — the reader can already see it.
> - No preamble, no sign-off, no meta-commentary about being an AI or about the summary itself. Begin with the opening paragraph.
> - If the input says it holds only some of the thread's comments, do not pretend to have read the rest.

User prompt (`summaryPrompt(thread)`, exact template): `` `Summarize the following Hacker News thread.\n\n<thread>\n${thread}\n</thread>` ``, where `thread` is `renderThread()`'s output — a header block (`Story: <title>`, optional `URL:`, optional `Score: N | Comments: N`), the self-post body if any, `Comments (N of M shown):`, then indented `[id] author: text` lines.

**`model/anthropic.ts`.** Model id **`claude-opus-5`**, `MAX_TOKENS = 16000`, request timeout 4 minutes. Call: `client.messages.stream({ model, max_tokens, thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, system: SUMMARY_SYSTEM, messages: [{role:'user', content: summaryPrompt(input)}] })`, consumed with `for await (const event of stream)`, forwarding only `content_block_delta` events with `delta.type === 'text_delta'` to `onDelta`. `effort: 'low'` is deliberate: thinking tokens are generated *before* the first visible token, so higher effort costs specifically time-to-first-token on a workload that isn't intelligence-sensitive. Usage is read via `stream.finalMessage()` **after** the loop (the SDK assembles it from already-consumed events, not a second request): `final.usage.input_tokens`/`output_tokens`, `final.model`. The API key comes from a Secrets Manager `GetSecretValueCommand`, cached once per cold start, accepting either a bare key or `{"apiKey":"..."}` JSON.

**`model/fake.ts` — the mocked-Anthropic layer.** Fully deterministic given its input: regex-extracts the title, counts `[id]`-prefixed comment lines, and yields 7 fixed markdown chunks (title/counts interpolated) with `env.fakeModelDelayMs` (default 120ms) between each via `setTimeout` from `node:timers/promises`. Bills `inputTokens: null, outputTokens: null` explicitly (not `0`, so a cost average can't quietly absorb it). **This is already exactly the shape a Vercel e2e mocked-Anthropic layer needs — reusable unmodified.**

**`store.ts` — key scheme and reuse rule.** `pk = ITEM#<id>`, `sk = ENRICH#<kind>#<generatedAt zero-padded 10 digits>#<inputKey>` (`generatedAt` precedes the hash so "newest first" is `ScanIndexForward:false`, not a scan). `inputKey` is `sha256` of the *exact rendered bytes* — not the story's `contentKey` (that never invalidates when comments arrive) and not a pure input hash alone (measured: HN re-ranks continuously, 7 consecutive requests produced 7 distinct keys and 7 paid generations — a correct key and a useless cache). The exact `usable()` comparison, both conditions required:
```
GROWTH_TOLERANCE = 0.15
for each candidate, newest first:
  was = candidate.input.totalComments; skip if was <= 0
  fresh = query.totalComments <= was * 1.15
  if !fresh: continue
  deep = query.comments !== undefined
    ? candidate.input.comments >= query.comments * 0.85
    : candidate.input.strategy === query.strategy && candidate.input.budgetChars === query.budgetChars
  if deep: return candidate
return null
```
`fresh` (growth) and `deep` (coverage) must both hold — omitting coverage was a real bug: a summary from a deliberately tiny slice was once served to a request for the whole thread; the reverse (richer summary answers a thinner request) is fine. `createDynamoStore()` (Query/Put over DynamoDB, TTL via `expiresAt`) is the only AWS-bound part; `usable()`, `pk()`/`sk()`, and `createMemoryStore()` (a `Map`, used when `STORE=memory`) are pure and store-agnostic.

**`app.ts` — SSE contract**, from `packages/schema/src/enrich-stream.ts`: `ENRICH_EVENT = { meta, delta, complete, error }`. `EnrichMetaSchema{itemId, cached, inputKey, input}` sent **before any model work**, then zero-or-more `EnrichDeltaSchema{text}`, then exactly one terminal `EnrichCompleteSchema{enrichments}` or `EnrichErrorSchema{error}`. A stream ending with no terminal event must be treated by the client as failure — a status line can't change after the first byte. `writer()` serializes every write (deltas + heartbeat) onto one promise-chain queue so a 15s-interval keepalive comment (`: keepalive\n\n`) can't interleave mid-frame. `cheapRead()` answers a cache hit with a single `firebase.getItem(id)` call (using `descendants` as a stand-in for `totalComments`, `strategy`/`budgetChars` as a stand-in for coverage) before paying for the full tree walk.

**Pure/portable vs. bound.** Portable as-is: `thread.ts`, `prompt.ts`, `model/fake.ts`, `model/index.ts`'s seam, `store.ts`'s `usable()`/key-shape/`createMemoryStore()`, `app.ts`'s route/SSE-sequencing logic, and all of `enrich-stream.ts`. Bound and requiring replacement: `model/anthropic.ts`'s Secrets Manager fetch (→ `ANTHROPIC_API_KEY` env var), `store.ts`'s `createDynamoStore()` (→ Redis/Postgres calls), `lambda-enrich.ts`'s `streamHandle` adapter (→ Vercel `ReadableStream` response), and `env.ts`'s `AWS_REGION`/`anthropicSecretId`.

---

## 4. The web app

**Routes**: `__root.tsx` (shell/nav/search/`AuthMenu`) → `index`/`ask`/`best`/`newest`/`show`/`jobs.tsx` (six near-identical `FeedPage` wrappers) · `item.$id.tsx` (`StoryHeader`+`ThreadSummary`+`CommentTree`) · `item.index.tsx` (`/item?id=`→`/item/$id` redirect) · `search.tsx` · `user.$id.tsx` (`UserProfile`+`AuthorHistory`).

**`data-testid`/`data-*` contract** (exhaustive):
- Nav/search: `nav-link` (+`data-active`), `search-input`.
- Feeds: `feed-title`, `story` (+`data-*` none, row is `<li>`), `story-rank`, `story-title`, `story-score`, `story-author`, `story-comments`.
- Pagination: `page-prev`/`page-next` (+`data-disabled=""`), `page-status`.
- Item page: `thread-summary` (+`data-state="idle"|"streaming"|"complete"|"error"`, `aria-busy`, `aria-live="polite"`), `thread-summary-request`, `thread-summary-text`, `thread-summary-meta`, `thread-summary-error`; `comment` (+`data-comment-id`, +`data-tombstone="deleted"|"dead"`), `comment-toggle` (+ native `aria-expanded`), `comment-author`.
- Search: `search-heading`, `search-empty`, sort `Link`s (+`data-active`).
- User page: `user-karma`, `user-created`, `author-filter` (+`data-active`), `author-item` (+`data-kind="story"|"comment"`).
- Auth (all Cognito-gated, to be dropped): `auth-user`, `auth-signout`, `auth-dev-name`, `auth-dev-login`.
- Boolean `data-*` convention throughout: present-empty-string when true, absent when false; value-carrying attrs (`data-state`, `data-kind`, `data-tombstone`, `data-comment-id`) carry real values.

**`queries.ts`**: `feedQueryOptions`/`itemQueryOptions`/`searchQueryOptions` (`enabled: query.length>0`)/`userQueryOptions`/`authorItemsQueryOptions`, plus auth-only `configQueryOptions` (`staleTime: Infinity`) and `meQueryOptions` — both drop. Global `QueryClient`: `staleTime: 30_000, retry: 1`, matched to the API's feed `max-age=30`.

**`api.ts`**: all typed fetchers funnel through `getJson(path)` → `apiFetch` (cdk-core) → schema-parse the body, `ErrorResponseSchema` on non-2xx. 1-based↔0-based page conversion for Algolia-backed endpoints happens at this one boundary. `ThreadSummary` bypasses `queries.ts`/`api.ts` entirely and calls `apiFetch('/events/v1/enrich/thread/:id')` directly, feeding the raw `Response.body` into `lib/sse.ts`.

**Router/loader pattern**: TanStack Router, file-based routes, `routeTree.gen.ts` generated by the Vite plugin but **committed** (typecheck runs before `vite build`, so a new route file needs a Vite run before `tsc` sees it). Every loader calls `context.queryClient.ensureQueryData(...)`; components `useSuspenseQuery` the same options — one cache, `defaultPreloadStaleTime: 0`. `AuthMenu` is the deliberate `useQuery` (non-suspense) exception so "who's signed in" never blocks the shell — moot once auth is dropped.

**`lib/sse.ts`**: hand-rolled parser over a `fetch` `Response`'s `ReadableStream` (not `EventSource`, which can't be pointed at an existing `fetch` body or wired to `AbortSignal`) — buffers on `\n\n` frame boundaries, joins multi-line `data:`, skips `:`-prefixed keepalive comments, flushes a trailing unterminated frame. No reconnect logic — one-shot per request. Fully framework-agnostic; drops into a Vercel Function's streamed SSE `Response` unchanged.

**`tokens.css`** semantic groups: surfaces (`--color-bg*`, `--color-surface*`), borders, text (`--color-text*`), accent (`--color-accent-surface/border/text/solid` + theme-independent `--color-accent-solid-text`/`--color-focus-ring-on-accent` pinned to `black-alpha` so the ring stays visible on the orange bar in both themes), danger (`--color-danger-*`), elevation (`--shadow-*`), an 8-step 4px space scale, 2 radii, a tight type scale (`--text-1..7`, 12–28px). All resolve to Radix Colors (`sand`+`orange`+`red`+`black-alpha`) declared on `:root`.

**`index.html`**: inline `<head>` script toggling `.dark` on `<html>` from `matchMedia('(prefers-color-scheme: dark)')`, before first paint — no flash, no manual toggle UI.

**Real-HN parity**: PRESENT — front page/top, newest, best, ask, show, jobs, item/thread view with nested comments, user profile + history (all/story/comment filter), search (relevance/date), pagination with continuing rank, comment collapse (`aria-expanded`), byline/age, host display equivalent to `from?site=`, `/item?id=` URL compat. MISSING (consistent with "read-only client," not a casualty of dropping auth) — submit/vote/flag/reply, `past` archive browsing, `newcomments`, favorites/hide, RSS. AI thread summary is the one non-HN feature and is the actual product.

---

## 5. E2E

No full-suite runtime is recorded anywhere (CI workflows, README, spec files, rule files) — the only recorded timings are PR-preview *infra* deploy numbers (`deploy 97s`/`push→comment 223s`), unrelated to Playwright.

| Spec | Test titles | Asserts | Live-HN dependent? |
|---|---|---|---|
| `smoke.spec.ts` | "the front page renders a feed of story rows"; "a story opens a nested comment tree" | 30 rows w/ title+comments link, >20 with score; busiest thread opens, nested comment renders | Yes — structural only |
| `feeds.spec.ts` | "the header links to every feed, and each one renders story rows"; "pagination walks forward and back, and ranks keep counting"; "the last page offers no next" | nav-link count, row counts ≤30; page-2 rank starts at 31; last-page next disabled | Yes |
| `search-and-user.spec.ts` | "the header search box runs a query and lists story rows"; "a query with no hits says so instead of rendering an empty list"; "a story byline opens the author profile and their history"; "an author history filters to stories and to comments" | query→results→back-nav; empty state; profile fields + history; `data-kind` filter narrows | Yes — live Algolia, pinned to `pg` (Paul Graham) as a stable high-volume account |
| `thread.spec.ts` | "collapsing a comment hides its replies and keeps its own header"; "HN's own item URL redirects to this app's"; "a comment byline links to its author" | `aria-expanded` toggle + header persists; `/item?id=N`→`/item/N`; author link | Yes |
| `summary.spec.ts` | "a summary is not requested automatically"; "requesting a summary reaches a completed state with no error"; "navigating away mid-stream leaves no error behind" | no auto-fetch; `data-state=complete` within 30s w/ text; abort-on-unmount doesn't crash | **No** — already runs against `MODEL_PROVIDER=fake`; this is the template for e2e against a mocked Anthropic layer |
| `auth.spec.ts` | 6 tests: dev-login round trip, machine-auth read-back, edge-gate redirect, cross-pool 401 isolation, prod-skip | Entirely Cognito/CloudFront-shaped | N/A — **drop wholesale, no post-auth equivalent** |

The four content specs are structural-by-design and will keep working unmodified against Vercel-hosted routes hitting live HN — no fixtures needed beyond a running server. `fixtures.ts`'s `test.extend` + `TARGET` (local/preview/prod) detection *pattern* is worth keeping even though its auth payload is deleted.

---

## 6. Tooling/conventions worth keeping

- **oxlint** (`.oxlintrc.json`): plugins `react`/`typescript`/`oxc`/`jsx-a11y`, `categories.correctness: "error"` (a11y failures break CI, not a final pass); overrides disable `react/rules-of-hooks` under `e2e/**` (Playwright's `use` fixture param isn't React's hook) and `react/only-export-components` under `routes/**` (file routes export both `Route` and a component by design).
- **stylelint** (`stylelint.config.js`): `stylelint-config-standard` + `-css-modules` + `-recess-order`, plus `@double-great/stylelint-a11y`, `stylelint-value-no-unknown-custom-properties`, `@css-modules-kit/stylelint-plugin`. Enforces the two-layer token system: `src/styles/**` may use raw hex/px, `*.module.css` may not (`declaration-property-value-disallowed-list` bans hex/rgb/hsl on color props and raw px on spacing/radius, but not border/width/height/outline — hairline borders stay literal px). `importFrom` lists the Radix scale files explicitly since the plugin doesn't follow `@import`. Class names enforced camelCase.
- **css-modules-kit (`cmk`)**: generates `.d.ts` into gitignored `generated/` during `typecheck`/`build`; a bad class name (`styles.typo`) is a compile error, not a runtime surprise.
- **No formatter, no semicolons, single quotes** — matched by hand throughout, no prettier config present.
- **`pnpm verify`** = `lint && typecheck && test && build` (root `package.json`); `lint` = `oxlint && stylelint "apps/web/src/**/*.css"`; `typecheck` = `pnpm -r run typecheck && tsc -b tsconfig.e2e.json` (the e2e project belongs to no package, typechecked separately).
- **Catalog** (`pnpm-workspace.yaml`): every dependency version pinned once in `catalog:`, `catalogMode: prefer`, manifests reference `"catalog:"` never a range. Deliberate pins worth carrying the *reasoning* for, not just the numbers: `typescript@~6.0.3` (TS 7 has no stable programmatic compiler API until 7.1, breaking `@css-modules-kit`'s TS plugin), `vitest@^4` (v5 changed mocking defaults), `@types/node@^24` (matched the Lambda `nodejs24.x` runtime — **revisit this pin against Vercel's supported Node runtime version**).
- **`erasableSyntaxOnly`/`verbatimModuleSyntax`** both on in `tsconfig.base.json` alongside `strict`/`isolatedModules`: no `enum`, no constructor parameter properties, `import type` for type-only imports.

---

## 7. AWS teardown inventory

Account `063257577013`, region **us-east-1**, hosted zone `Z038502736IM0QLQT7VFN` (`ty.ler.dev`, **shared — never delete the zone, only yahn's records in it**).

### ⚠️ Must NOT be deleted (shared with other sites / the account)
| Resource | Why |
|---|---|
| The AWS account itself | Hosts `ThaiLerDevSiteStack`, `ThaiLerDevGithubOidcStack` (thai.ler.dev production), cdk-core's own `CdkCore*` stacks, other unrelated production stacks |
| GitHub OIDC provider | Owned by `ThaiLerDevGithubOidcStack`; `YahnGithubOidc` only *imports* it |
| Secret `cdk-core/google-oauth` | Shared Google OAuth client, used by every cdk-core-hosted site including thai.ler.dev |
| ACM validation CNAME `_<hash>.yahn.ty.ler.dev` | Shared between old and new certs for this domain; confirmed to survive one old-stack deletion (2026-09-07) but flagged as "one observation, not a guarantee" — re-verify with `describe-certificate`/`list-resource-record-sets` after any cert-stack deletion, before touching the record |
| `ty.ler.dev` hosted zone | Shared with other subdomains |

### Yahn-specific — safe to delete once confirmed via `aws cloudformation list-stacks`
| Stack | Contains |
|---|---|
| `YahnShared` | ACM cert, SANs `[yahn.ty.ler.dev, *.preview.yahn.ty.ler.dev]` |
| `YahnPreview` | Preview S3 bucket, KeyValueStore, router CloudFront Function, preview distribution, wildcard DNS, SSM params, preview Cognito pool (`yahn-ty-ler-dev-preview`) + `machine` app client + `claude` native user, secrets `preview-machine-user`/`preview-session-secret`, shared `/auth/*` Lambda |
| `YahnSite` | Prod S3 bucket, prod distribution, apex DNS, both Lambdas, `EnrichTable` (**RemovalPolicy.RETAIN — survives stack delete, needs explicit `delete-table`**), log groups `YahnSite-ApiLogs…`/`YahnSite-EventsLogs…` (2yr + RETAIN, same caveat), prod Cognito pool (`yahn-ty-ler-dev`), gate KVS + session secret + `/auth/*` Lambda |
| `Yahn-pr-<n>` | Per-PR Lambdas + `PreviewDeployment` (DESTROY policies — should already be gone for closed PRs) |
| `YahnGithubOidc` | `yahn-github-deploy` IAM role only (imports, does not own, the OIDC provider) |

**Secrets (yahn-only)**: `yahn-ty-ler-dev/anthropic`, `yahn.ty.ler.dev/preview-machine-user`, `yahn.ty.ler.dev/preview-session-secret`.
**Cognito**: `YahnSite` prod pool (no native users, refresh-token-only app client) + `YahnPreview` pool (browser + `machine` app clients, `claude` native user) — both isolated, safe to delete independently of the shared Google client.
**S3**: prod site bucket, preview asset bucket (`autoDeleteObjects` on).
**KeyValueStore**: preview router KVS, prod edge-gate KVS.
**Log groups**: explicit stack-owned ones above, plus **leaked** `/aws/lambda/Yahn-pr-<n>-…` groups from cdk-core's custom-resource Lambdas that no stack owns (historically 24 leaked `YahnAppStack-*` groups needed manual deletion once) — reclaimed by `cdk-core sweep`.
**SSM params**: `preview/kvsArn`, `preview/bucketName` (cached in committed `cdk.context.json`), plus 4 auth params (`authIssuer`/`authClientId`/`authMachineClientId`/`authDomain`) created by `YahnPreview`.

**GitHub repo secrets/variables**: `AWS_DEPLOY_ROLE_ARN` (var — deploy/preview/teardown/cleanup workflows), `CLAUDE_CODE_OAUTH_TOKEN` (secret — unrelated to AWS, keep), `CLAUDE_APP_ID` (var, optional), `CLAUDE_APP_PRIVATE_KEY` (secret, optional), default `GITHUB_TOKEN` (as `GH_TOKEN` in cleanup/pr workflows), `GH_REPO` env (pr-teardown, no checkout so no git remote to infer from).

**Suggested order**: `Yahn-pr-*` → confirm sweeper/dry-run clean → `YahnSite` (then explicitly delete the RETAINed `EnrichTable` + its 2 log groups if data isn't wanted) → `YahnPreview` → `YahnShared` last (re-verify the cert validation CNAME before/after) → `YahnGithubOidc` (role only, never the OIDC provider) → yahn-only secrets → GitHub repo vars/secrets.

---

## 8. AWS-independent lessons for the new CLAUDE.md

- **Set a cache/response header after the upstream call resolves, never before; `no-store` on every non-2xx.** A header set pre-`await` survives on a thrown response — a transient upstream blip gets cached as a valid answer. *(`.claude/rules/api.md`)*
- **`z.looseObject(...)`, never `z.object(...).loose()`, for a recursive schema.** `.loose()` reads `shape` eagerly, firing a `get children()` getter from inside its own initializer and throwing a TDZ error at import time. *(`.claude/rules/api.md`, `packages/schema/src/item.ts`)*
- **A cache-key design for AI output needs both a freshness bound and a coverage bound — either alone is a real, invisible bug.** A pure input hash never hits on a continuously-changing source (measured: 7 distinct keys on 7 consecutive requests); a pure "close enough" freshness check once served a summary generated from a deliberately tiny slice to a request for the whole thing. Both failure modes were only caught by live measurement. *(`.claude/rules/api.md`, `apps/api/src/enrich/store.ts`)*
- **Send the first byte of a stream before doing the expensive work.** Under any read-timeout deadline this is a correctness property, not UX polish — a producer that stays silent too long gets cut off mid-work by the transport layer while still running. *(`.claude/rules/api.md`, `enrich/app.ts`'s `meta`-before-model-work + 15s heartbeat)*
- **A stream's failure has to be in-band once the first byte is sent**, and a client must treat "ended with no terminal event" as failure, never as a short answer. *(`.claude/rules/api.md`, `packages/schema/src/enrich-stream.ts`)*
- **Never awaited `onDelta` lets the producer outrun the socket and buffer the whole output in memory** — the one thing a streaming endpoint exists to avoid. *(`enrich/model/index.ts`'s `Model.summarize` contract)*
- **A committed generated file can still gate what typecheck sees.** `routeTree.gen.ts` is generated but committed because `tsc -b` runs before `vite build` — a new route file isn't visible to typecheck until something runs Vite once. *(`.claude/rules/web-ui.md`)*
- **Boolean `data-*` convention**: `data-x=""` when true, the attribute absent when false — never `data-x={true}` (renders `"true"`, which CSS still matches but Playwright's `toHaveAttribute('data-x','')` does not). *(`.claude/rules/web-ui.md`)*
- **Assert the accessible state, not the styling hook** — collapse via `aria-expanded`, not a class or `hidden`, so the test doesn't care how the DOM implements it. *(`.claude/rules/testing.md`)*
- **Don't assert on a Playwright locator whose filter depends on the state under test** — it re-resolves on every assertion and can silently start matching a different element. Resolve to a fixed attribute selector first, then assert. *(`.claude/rules/testing.md`)*
- **Write the e2e spec before the UI it covers** — the `data-testid` set becomes a contract the component is built against, which is why specs survived a full component rewrite untouched. *(`.claude/rules/testing.md`)*
- **Assertions against a live, changing upstream must be structural, never content-based** ("30 rows, each with a title" — not "the top story is X"). *(`.claude/rules/testing.md`)*
- **Never sort HN children by id or time; `kids`/tree order is HN's own ranked order.** A deleted item's id still appears in its parent's `kids` — a tree walk must tolerate a tombstone child. *(`.claude/rules/hn-data.md`)*
- **`descendants` is the total subtree count, not `kids.length` — pass it through, never compute it.** A missing item is HTTP 200 with a `null` body, not a 404; mapping that to a real 404 is the API layer's job. *(`.claude/rules/hn-data.md`)*
- **Pin a dependency version for a stated, specific compatibility reason, not "latest stable."** *(`.claude/rules/typescript-config.md`)*
- **Check current library docs before writing against a fast-moving package** — Base UI renamed its package and went 1.0; writing from memory gets both the import path and the API wrong. *(`.claude/rules/web-ui.md`)*
- **A claim about a third party's undocumented behavior needs a re-runnable script, not just a recorded date** — `scripts/ordering-spike.mjs` re-derives the Algolia-ordering finding against live data on demand. *(`CLAUDE.md`)*
- **Measure with interleaved, randomized-order samples, not sequential batches** — a 512-vs-1024MB Lambda memory experiment and a compression on/off experiment both reversed their conclusion once samples were interleaved instead of run in blocks. Directly transferable to any Vercel-vs-config comparison. *(`.claude/rules/cdk.md`)*
