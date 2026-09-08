---
paths:
  - "apps/api/**"
  - "packages/schema/**"
---

# apps/api and the response contract

Loaded when you touch the API or the shared schema.

- **The Lambda is thin on purpose.** Routing, validation, cache headers, error mapping — that
  is all of it. Anything that could be subtly wrong (the tree merge, sibling ordering, node
  caps, tombstones) lives in `packages/hn`, where it is pure and unit-tested without a server.
  A handler that grows a `for` loop over HN items is in the wrong file.
- **zod at every boundary.** Params and query strings go through `zValidator`, and a failure is
  `z.prettifyError` in a `{ error: string }` body with a 400. Every rejection has that one
  shape, so a client never branches on the body.
- `src/lambda.ts` and `src/server.ts` both wrap the same `createApp()`. `pnpm dev` and
  production are the same code path with nothing mocked between them; only the thing calling
  `fetch` on the app differs.
- **Error mapping is a contract, not a detail.** `NotFoundError` → 404 (Firebase answers a
  missing item with `200 null`, so producing a real 404 is this layer's job). `UpstreamError` →
  **502**, never 500: the request was fine and the upstream was not, and a client that sees 500
  reasonably blames us and stops retrying.
- **Cache-Control is where this Lambda earns its keep.** CloudFront honors what the origin sets,
  so a cached front page is one edge hit instead of 31 HN requests. Feeds are `max-age=30`,
  items `max-age=60`, both with `stale-while-revalidate` so a rerank never costs a viewer full
  origin latency. Measured through the deployed edge: **1.23s cold, 0.013s warm** on
  `/api/v1/feeds/top`, with `x-cache: Hit from cloudfront` on the repeat.
- **Set the cache header *after* the upstream call resolves, and `no-store` on every non-2xx.**
  A header set before the `await` is still on the response when the call throws, so one HN blip
  goes out as a 502 carrying `max-age=30`, and that outage is then pinned at every edge for
  thirty seconds and served stale for another three hundred. This was a real bug, invisible
  until the CDN existed — the CDN exists now, and the fix is verified in production: every
  non-2xx comes back `cache-control: no-store` and `x-cache: Error from cloudfront`, never a
  Hit, on repeated requests. Do not "tidy" the header back to the top of a handler. This is a deliberate deviation from thai.ler.dev, which uses
  `CACHING_DISABLED` on `/api/*` — correct for a per-user sync API, wrong for a public
  read-only one. Do not "fix" it back.
- **A route whose response varies by caller must set `Cache-Control: no-store`, and here that is
  a security control rather than a performance one.** `/api/*` runs on
  `CachePolicies.originDecides`, whose cache key is **query strings only** —
  `headerBehavior: none()`. `x-id-token` reaches the Lambda (the origin request policy is
  `ALL_VIEWER_EXCEPT_HOST_HEADER`) but is **not** part of the cache key, so a per-user body
  without `no-store` gets one user's response pinned at every edge and served to everyone for up
  to 300s. Every other cdk-core site runs `/api/*` on `CACHING_DISABLED` and cannot hit this;
  yahn is the only one that can. `/api/v1/me` is the one such route today, and it is also the
  one place in this file that sets its header **before** the work rather than after — there is
  no upstream call to fail, and the comment there says so.
- **`getAuthUser(c)` in `src/auth.ts` is the only place the API learns who is calling.** It
  delegates to `@tylerschloesser/cdk-core/auth/server` and a middleware puts an `AuthUser | null`
  on the context, so a handler never reads a header itself. The token arrives in `x-id-token`,
  not `Authorization` — CloudFront's origin access control signs the origin request with SigV4
  and overwrites `Authorization`. `.claude/rules/auth.md` has the two pools, the three `AUTH`
  modes and the machine user.

## The enrichment API — a second app, a second Lambda, a second behavior

`createEnrichApp()` in `src/enrich/app.ts` is a separate Hono app from `createApp()`, and the
separation is forced by infrastructure rather than chosen. Response streaming is an invoke-mode
property of a Lambda function URL and is **fixed at creation**, so a streaming route cannot live
behind the read API's buffered URL; and read responses are cached hard at the edge while these
must not be cached at all, which is a property of a CloudFront behavior. `src/lambda-enrich.ts`
wraps it with `streamHandle`; `src/server.ts` gives it its own local port and Vite's dev proxy
mirrors the split.

- **Do not mount it into the read app with `app.route()`.** Hono does not carry a sub-app's
  `notFound` and `onError` across a mount, and the read app's error mapping is a contract, not a
  detail. Two ports locally is also simply what production is.
- **It is `GET /events/v1/enrich/thread/:id`, not POST**, and that is a measured decision rather
  than a stylistic one. Under origin access control CloudFront signs the origin request with
  SigV4, whose signature covers a hash of the payload that CloudFront cannot compute — so a POST
  *with a body* 403s unless the viewer itself sends `x-amz-content-sha256`. That is a real cost
  to every client and it rules out `EventSource`. The reservation in this file was for the
  **prefix**; `.claude/rules/cdk.md` has the full result table.
- **Its root is `/events`, not `/api`, and the split is at the first label on purpose.** A
  CloudFront behavior is selected by path pattern, and the two backends' patterns must not
  overlap — a streaming pattern nested under `/api/` is exactly what cdk-core's preview router
  refuses to render, because a CloudFront Function cannot change which behavior was selected. The
  pattern `/events/*` is what selects the streaming Lambda in prod and in every preview, so a
  new streaming route goes under `/events/`, never under `/api/`. Vite's dev proxy mirrors the
  same two roots.
- **Failure after the first byte has to be in-band.** A stream that has already sent its status
  line cannot change it, so the contract is: `meta` first, then `delta`s, then exactly one
  terminal `complete` or `error`. A client that sees the stream end without a terminal event
  must treat that as a failure, not as a short summary. `@yahn/schema`'s `enrich-stream.ts` is
  the shared definition, and it lives there precisely because it is the one place producer and
  consumer can drift invisibly.
- **`meta` is sent before any model work starts, and that is not cosmetic.** CloudFront's origin
  `readTimeout` is 60s and applies to the first byte *and* to the gap between packets, so a
  producer that thinks silently for longer is cut off at the edge while the Lambda runs on.
- **Both obvious ways to key the cache are wrong, in opposite directions, and each was caught
  by measurement rather than by reading.** `sk = ENRICH#<kind>#<generatedAt>#<inputKey>`.
  - The plan said `ENRICH#<kind>#<contentKey>`. A story's `contentKey` is `sha256(url ?? text)`,
    fixed the moment it is posted — it does not move when comments arrive, so the first summary
    of an empty thread would be served forever.
  - Hashing the model input instead fixes that and breaks the other way. Measured against a live
    front-page thread: **seven consecutive requests produced seven distinct keys and seven paid
    generations.** HN re-ranks continuously and comments keep arriving, so the exact bytes are
    never twice the same and the cache never hits *at all* — which is exactly the "serve every
    later viewer from the table" the epoch exists to do. A pure input hash is a correct key and
    a useless cache.
  - So a miss falls back to the newest stored summary, reused when **the thread has not grown
    more than 15%** since it was written *and* it read at least as much of the thread as this
    request would. A thread that has stopped growing — which is when nearly all reads happen —
    is then a permanent hit, while a live one regenerates on a geometric schedule instead of
    once per viewer.
  - **The coverage half of that rule is not optional**, and it was also caught by measurement:
    without it a summary generated from a deliberately tiny slice was served to a request for
    the whole thread. The reverse is fine and is allowed — a *richer* stored summary answering a
    thinner request is both cheaper and better.
  - `generatedAt` precedes the hash in the sort key so "newest first" is a query rather than a
    scan. `apps/api/src/enrich/store.test.ts` pins all of the above offline.
- **What goes to the model is `budget` capped at 200,000 characters, and that number is
  measured.** It is a *cap*, so an ordinary thread is sent whole — item 8863's entire tree is
  26k chars — and it binds only on the largest threads on HN. Measured end to end through a
  deployed edge on item 49563355 (1,622 nodes), billed token counts from the model itself:

  | strategy | comments sent | input tokens | cost | time to first token |
  | --- | --- | --- | --- | --- |
  | `budget` 40k | 92 / 1622 | 13,799 | $0.11 | 9.4s |
  | `top-level` | 213 / 1622 | 23,313 | $0.16 | 9.9s |
  | **`budget` 200k** | **670 / 1622** | **67,827** | **$0.37** | **11.9s** |
  | `full` | 1515 / 1622 | 160,913 | $0.85 | 12.3s |

  The quality difference is **not** in the headline points, which all four get right. It is in
  the *disagreements*: `budget` at 40k misses entire arguments, because they live in deep reply
  chains and a breadth-first walk truncates those first. At 200k they come back — the same
  disputes `full` surfaces — for 55% less. Above 200k nothing new appeared for another $0.47.

  Two things about that measurement are worth keeping. **The size curve is linear, with no
  elbow** — 40k/80k/120k/200k/300k/400k chars admit 92/255/385/670/1007/1337 comments — so there
  is no "optimal" cap to discover and this is a cost/coverage judgment, not an optimization.
  And **the estimate the plan started from was low**: it put this thread at ~100k tokens and
  ~$0.50, where the billed figure for the whole tree is 161k tokens and $0.85. Rendering the
  tree as indented text rather than JSON is what shrinks it at all (718KB of JSON → 493KB of
  text); quote billed `usage`, not a chars-per-token estimate, which was itself 25% optimistic
  here.

  `?strategy=` and `?budget=` on the endpoint exist so all of this is re-runnable against a
  deployed edge without a redeploy.
- **The model is reached only through `getModel()` in `src/enrich/model/`,** and
  `applyLocalDefaults()` sets `MODEL_PROVIDER ??= 'fake'`. That is what keeps `pnpm dev`,
  `pnpm verify` and `pnpm e2e` free of credentials. A real key is required in exactly one place:
  Lambda, where the CDK sets `MODEL_PROVIDER=anthropic` and grants Secrets Manager read. The key
  is fetched once per cold start and is never a plaintext env var, which would put it in the
  CloudFormation template.
- **State is a DynamoDB `TableV2`** keyed `pk=ITEM#<id>` /
  `sk=ENRICH#<kind>#<generatedAt>#<inputKey>` for enrichments — see the correction above. `pk=USER#<cognitoSub>` is still the reserved shape for
  per-user data and is not built: auth landed, but yahn has no per-user state yet, so
  `/api/v1/me` reads the token and nothing writes a row.

## The schema

- Every object is `z.looseObject`. The HN README requires clients to tolerate new fields, and a
  deployed web build must keep parsing an API that has since grown one. Do not "tighten" these.
- **`contentKey` is `sha256(url ?? text).slice(0, 16)`** — a stable identity for an item's *own*
  content, which is what an enrichment over that content (an article summary, reader mode) will
  cache against. It is **not** what a thread summary keys on: comments arriving do not change it.
  It cannot be backfilled consistently once items have moved, which is why it was populated
  before anything read it.
- **`enrichments` is the slot, and Epoch 4 gave it its first occupant.** `threadSummary` is
  optional inside an optional field, so a response that carries none is unchanged and a client
  that ignores it still parses. The read endpoints still never populate it — the enrichment
  stream's terminal `complete` event carries an `Enrichments` object and the client merges it
  into the story it already holds, which is why the payload shape is shared rather than
  invented twice.
- `CommentSchema` must use `z.looseObject(...)`, never `z.object(...).loose()` — `.loose()`
  reads `shape` eagerly and fires the recursive `get children()` from inside its own
  initializer, which throws at import time.
- `ItemResponse.source` names the path that actually produced the tree, not the configured one,
  and `truncated` says the tree is a prefix. A client that hides either is lying about the
  thread.
