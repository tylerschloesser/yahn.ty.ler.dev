# yahn.ty.ler.dev

A read-only Hacker News client. Near-vanilla HN today — front page, comment threads — built so
that the thing it exists for can be added later without reshaping anything: LLM augmentation.
Article and comment summaries, fact-checking, a first-party reader mode.

Nothing about that is built yet. What is built is the shape that makes it cheap.

## Quick start

```bash
pnpm install
pnpm dev        # api on :3001, web on :5173 — no credentials needed
pnpm verify     # lint, typecheck, test, build
pnpm e2e        # Playwright; boots its own dev servers
```

Both Hacker News APIs are public and unauthenticated, so `pnpm dev` runs the *real* backend
locally with nothing mocked. There is no secret to obtain and no deployed environment to point
at. That is the property that lets an agent — or a new contributor — verify a change end to end
before opening a PR.

## Layout

```
apps/web       @yahn/web      Vite + React 19, TanStack Router + Query, CSS Modules
apps/api       @yahn/api      Hono lambdalith — routing, validation, cache headers
packages/hn    @yahn/hn       Firebase + Algolia clients, comment-tree merge. Pure, tested.
packages/schema @yahn/schema  the zod contract, shared by web and api
docs/hn-api.md                the complete HN API reference
e2e/                          one Playwright spec, structural assertions only
```

`packages/hn` is separate from `apps/api` so the Lambda stays genuinely thin and the interesting
logic — tree merge, ordering, node caps, retries — is pure and testable without a server. Every
package is consumed as **raw TypeScript source** through its `exports` map: no build output, no
`composite`, no project references between them.

## The HN data problem

The official Firebase API has **no batch fetch**. One HTTP request per item, always. A front
page plus every full comment tree measured **4,636 requests**; one thread alone was 1,461.

The Algolia HN Search API returns an entire comment tree already nested in a single request
(0.33s, 41KB, against 72 Firebase requests for the same thread) and is the only way to search.
But it lags indexing, reports `points: null` on comments, and — measured, not assumed — orders
its nested `children` **chronologically**, not in HN's ranked display order.

So neither API is sufficient alone, and the choice between them is a seam rather than a
decision baked into call sites:

```ts
// packages/hn/src/tree/index.ts
export function getCommentSource(): CommentSource
```

The default is `firebase`, because ordering is the thing a reader notices. `COMMENT_SOURCE=hybrid`
takes Algolia's whole tree in one request instead, and is the right fallback when Algolia is the
only thing answering. `scripts/ordering-spike.mjs` is the measurement that decided it; re-run it
rather than re-deriving the answer.

The full reference — every endpoint, every field per item type, the deleted/dead tombstone
shapes, ETag semantics, rate limits, and the measurements above — is in `docs/hn-api.md`.

## What makes the LLM work cheap later

Four properties, all free to build now and expensive to retrofit:

1. **An `enrichments` slot on every item**, always absent today. Adding the first summary
   changes no response shape and no component contract.
2. **A `contentKey` on every item** — `sha256(url ?? text).slice(0, 16)`. The key an enrichment
   is cached against: a summary stays valid exactly as long as the content it summarized is
   unchanged. Impossible to backfill consistently later.
3. **The read path is GET-only and deterministic**, so CloudFront caches it hard. Enrichment
   will be a different Lambda on a different behavior — it streams, and response streaming is an
   invoke-mode property of a Function URL that is fixed at creation. `POST /api/v1/enrich/**` is
   reserved for it.
4. **`getUserId()` returns `null` today** from one function. When Cognito lands, that function
   changes and nothing else does.

## API

```
GET /api/health
GET /api/v1/feeds/:feed?page=1     feed ∈ top|new|best|ask|show|job
GET /api/v1/items/:id
GET /api/v1/users/:id
GET /api/v1/search?q=&page=&sort=relevance|date
```

Same-origin under one CloudFront distribution, so no CORS and no preflight — and cookies will
work when auth arrives. The origin sets short `Cache-Control` with `stale-while-revalidate`;
CloudFront honors it, which is how a cached front page becomes one edge hit instead of 31 HN
requests.

## Conventions

Adopted wholesale from [thai.ler.dev](https://thai.ler.dev): oxlint + stylelint and no
formatter, no semicolons, single quotes, a two-layer CSS token system, and a dependency catalog
that manifests reference as `"catalog:"` rather than a range. `CLAUDE.md` and `.claude/rules/`
carry the constraints an agent needs; this file carries the story for people.
