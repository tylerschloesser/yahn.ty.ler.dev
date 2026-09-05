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
  origin latency. This is a deliberate deviation from thai.ler.dev, which uses
  `CACHING_DISABLED` on `/api/*` — correct for a per-user sync API, wrong for a public
  read-only one. Do not "fix" it back.
- **`getUserId(c)` in `src/auth.ts` is the only place the API learns who is calling.** It
  returns `null` today and a middleware puts it on the context, so it is wired rather than
  decorative. A handler that reads an auth header itself is what would make Cognito expensive
  later. The token will arrive in `x-id-token`, not `Authorization` — CloudFront's origin
  access control signs the origin request with SigV4 and overwrites `Authorization`.
- **`POST /api/v1/enrich/**` is reserved and deliberately unbuilt.** It cannot share this
  Lambda: enrichment streams, and `RESPONSE_STREAM` is an invoke-mode property of the Function
  URL fixed at creation. It cannot share the `/api/*` CloudFront behavior either, because these
  responses are cached hard and that one must not be cached at all. Reserving the prefix is what
  makes the split cheap.
- **State, when it arrives, is a DynamoDB `TableV2`** keyed `pk=ITEM#<id>` /
  `sk=ENRICH#<kind>#<contentKey>` for enrichments, and `pk=USER#<cognitoSub>` for per-user data.
  Not built here. Recorded so it is not reinvented differently.

## The schema

- Every object is `z.looseObject`. The HN README requires clients to tolerate new fields, and a
  deployed web build must keep parsing an API that has since grown one. Do not "tighten" these.
- **`contentKey` and `enrichments` are load-bearing absences.** `contentKey` is
  `sha256(url ?? text).slice(0, 16)` — the key an enrichment caches against, so a summary stays
  valid exactly as long as its content is unchanged. It cannot be backfilled consistently once
  items have moved. `enrichments` is an always-absent slot, so the first summary changes no
  response shape and no component contract. Neither has a consumer today. That is the point.
- `CommentSchema` must use `z.looseObject(...)`, never `z.object(...).loose()` — `.loose()`
  reads `shape` eagerly and fires the recursive `get children()` from inside its own
  initializer, which throws at import time.
- `ItemResponse.source` names the path that actually produced the tree, not the configured one,
  and `truncated` says the tree is a prefix. A client that hides either is lying about the
  thread.
