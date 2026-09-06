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
- **`getUserId(c)` in `src/auth.ts` is the only place the API learns who is calling.** It
  returns `null` today and a middleware puts it on the context, so it is wired rather than
  decorative. A handler that reads an auth header itself is what would make Cognito expensive
  later. The token will arrive in `x-id-token`, not `Authorization` — CloudFront's origin
  access control signs the origin request with SigV4 and overwrites `Authorization`.

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
- **It is `GET /api/v1/enrich/thread/:id`, not POST**, and that is a measured decision rather
  than a stylistic one. Under origin access control CloudFront signs the origin request with
  SigV4, whose signature covers a hash of the payload that CloudFront cannot compute — so a POST
  *with a body* 403s unless the viewer itself sends `x-amz-content-sha256`. That is a real cost
  to every client and it rules out `EventSource`. The reservation in this file was for the
  **prefix**; `.claude/rules/cdk.md` has the full result table.
- **Failure after the first byte has to be in-band.** A stream that has already sent its status
  line cannot change it, so the contract is: `meta` first, then `delta`s, then exactly one
  terminal `complete` or `error`. A client that sees the stream end without a terminal event
  must treat that as a failure, not as a short summary. `@yahn/schema`'s `enrich-stream.ts` is
  the shared definition, and it lives there precisely because it is the one place producer and
  consumer can drift invisibly.
- **`meta` is sent before any model work starts, and that is not cosmetic.** CloudFront's origin
  `readTimeout` is 60s and applies to the first byte *and* to the gap between packets, so a
  producer that thinks silently for longer is cut off at the edge while the Lambda runs on.
- **The cache key is a hash of the model input, not the story's `contentKey`.** `contentKey` is
  `sha256(url ?? text)`, fixed the moment a story is posted — it does not move when comments
  arrive, so keying a *thread* summary on it would pin the first summary of an empty thread
  forever. `sk = ENRICH#<kind>#<inputKey>` where `inputKey` hashes the exact bytes sent to the
  model, which also means two selection strategies can never serve each other's answers.
- **The model is reached only through `getModel()` in `src/enrich/model/`,** and
  `applyLocalDefaults()` sets `MODEL_PROVIDER ??= 'fake'`. That is what keeps `pnpm dev`,
  `pnpm verify` and `pnpm e2e` free of credentials. A real key is required in exactly one place:
  Lambda, where the CDK sets `MODEL_PROVIDER=anthropic` and grants Secrets Manager read. The key
  is fetched once per cold start and is never a plaintext env var, which would put it in the
  CloudFormation template.
- **State is a DynamoDB `TableV2`** keyed `pk=ITEM#<id>` / `sk=ENRICH#<kind>#<inputKey>` for
  enrichments — see the correction above; this rule previously said `<contentKey>` and that was
  wrong for anything keyed on comments. `pk=USER#<cognitoSub>` is still the reserved shape for
  per-user data and is not built.

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
