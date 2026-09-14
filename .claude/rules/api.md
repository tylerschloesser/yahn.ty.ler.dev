---
paths:
  - "api/**"
  - "server/app.ts"
  - "server/routes/**"
  - "shared/schema/**"
---

# The API and the response contract

Loaded when you touch the API or the shared schema.

- **The handler is thin on purpose.** Routing, validation, cache headers, error mapping — that
  is all of it. Anything that could be subtly wrong (the tree merge, sibling ordering, node caps,
  tombstones) lives in `server/hn/`, where it is pure and unit-tested without a server. A handler
  that grows a `for` loop over HN items is in the wrong file.
- **zod at every boundary.** Params and query strings go through `@hono/zod-validator`, and a
  failure is `z.prettifyError` in a `{ error: string }` body with a 400. Every rejection has that
  one shape, so a client never branches on the body.
- `api/index.ts` and `server/dev.ts` both wrap the same `createApp()` from `server/app.ts`.
  `pnpm dev` and the deployed function are the same code path — only the thing calling `fetch` on
  the app differs.
- **Error mapping is a contract, not a detail.** `NotFoundError` → 404 (Firebase answers a
  missing item with `200 null`, so producing a real 404 is this layer's job). `UpstreamError` →
  **502**, never 500: the request was fine and the upstream was not, and a client that sees 500
  reasonably blames us and stops retrying. An unknown route is 404 JSON, not a platform default
  page.
- **Set the cache header *after* the upstream call resolves, and `no-store` on every non-2xx.**
  A header set before the `await` is still on the response when the call throws, so one HN blip
  would otherwise be cached at the edge as a valid answer. This was a real, invisible bug before
  a CDN existed to expose it. Do not "tidy" the header back to the top of a handler.
- **Cache-Control values:** feeds `public, s-maxage=30, stale-while-revalidate=300`; items,
  users, author-items and search `public, s-maxage=60, stale-while-revalidate=300`. `/api/health`
  is `no-store`. See `.claude/rules/vercel.md` for how Vercel's CDN actually treats these values —
  it is not CloudFront.
- **`Vercel-Cache-Tag`** is set after the await on every cacheable route (`feed:<name>`,
  `item:<id>`, `user:<id>`), for a future on-demand purge. Nothing purges by tag yet in this
  epoch — do not build a purge path without a chunk asking for one.
- There is no auth and no per-caller response in this epoch: every route's output depends only on
  its params and query, which is what makes the cache rules above safe as written. A future route
  whose output depends on the caller must be `no-store` — that would be a security control here,
  not only a performance one.

## The schema

- Every object is `z.looseObject(...)`. The HN README requires clients to tolerate new fields,
  and a deployed build must keep parsing an API that has since grown one. Do not "tighten" these.
- **`CommentSchema` must use `z.looseObject(...)`, never `z.object(...).loose()`** — `.loose()`
  reads `shape` eagerly and fires the recursive `get children()` getter from inside its own
  initializer, which throws a TDZ error at import time.
- `ItemResponse.source` names the path that actually produced the tree, not the configured one,
  and `truncated` says the tree is a prefix. A client that hides either is lying about the thread.
- The `enrichments` slot on an item stays optional and loose; nothing populates it yet. Do not
  build server/enrich, server/jobs, or server/store — they belong to Epoch 2 and do not exist in
  this repo yet.
