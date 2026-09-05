---
paths:
  - "packages/hn/**"
---

# The HN data layer

Loaded when you touch `packages/hn/`.

**Read `docs/hn-api.md` first.** It is the complete, mined API reference — every endpoint, every
field per item type, the tombstone shapes, measured latencies and request counts. Do not
re-derive any of it from the live APIs, and do not write a field list from memory.

## Two APIs, and why both

- **Firebase** (`hacker-news.firebaseio.com/v0`) is authoritative: live `score`/`descendants`,
  and `kids` in HN's ranked display order. It has **no batch fetch** — one HTTP request per
  item, always. A front page plus every full comment tree measured **4,636 requests**.
- **Algolia** (`hn.algolia.com/api/v1`) returns an entire comment tree already nested in one
  request (`items/8863` → 0.33s, 41KB, versus 72 Firebase requests) and is the only search
  option. It lags indexing, returns `points: null` on comments, and caps pagination at 1,000
  hits. **10,000 requests/hour/IP**, with no `X-RateLimit-*` headers — you discover the limit by
  being blocked, which is the argument for caching hard.

## Comment ordering: the spike's answer

**Algolia does not preserve HN's ranked order — at any depth.** Its nested `children` arrays are
strictly ascending by id, i.e. chronological. Measured 2026-09-05 by
`scripts/ordering-spike.mjs` against four live front-page threads (49563851, 49574167, 49570545,
49570669, 96–389 comments each):

- **195 of 195** Algolia `children` arrays with two or more entries were strictly ascending by id
  — top level and every depth below it.
- HN's own displayed order is **not** ascending by id on any of the four, so ranked order is
  genuinely different from chronological rather than coincidentally equal.
- Firebase `kids` **agreed with HN's displayed top level**: identical on two threads, and on the
  other two differing by a single adjacent transposition, which is live re-ranking between two
  concurrent fetches rather than a different ordering rule.

**Therefore `getCommentSource()` defaults to `firebase`**, per the plan's stated rule ("if
ordering is wrong at depth, flip the default to `firebase`"). The Firebase source BFSes the tree
under a concurrency limit and a node cap; ordering is correct at every level, and the cost is
one request per node.

`hybrid` still exists behind `COMMENT_SOURCE=hybrid` and is still the right fallback when Algolia
is the only thing that answers, but it is no longer the default: it buys one round trip at the
price of wrong sibling order everywhere.

> If you are looking for a cheaper correct option, the one this spike suggests but the plan did
> not adopt is: build the tree from Algolia, then re-order each level from that parent's Firebase
> `kids`. That is one request per *non-leaf* comment (48 rather than 315 on 49563851) instead of
> one per comment. Nothing here implements it. Do not switch to it without measuring.

## Invariants

- `kids` is HN's ranked display order. **Never sort by id or time** — that is exactly the bug the
  spike found in Algolia.
- `descendants` is the total subtree count, not `kids.length`. Pass it through; never compute it.
- A missing item is HTTP **200 with a `null` body**, not a 404. Mapping that to `NotFoundError` is
  this package's job.
- `deleted` and `dead` only ever appear as `true`, never `false`. A deleted item loses `by`,
  `text` and `kids`; a dead one keeps `by` and `text`. **A deleted item's id still appears in its
  parent's `kids`**, so a tree walk must tolerate a child that is a tombstone.
- An empty-string `url` is not a url — the README's own job example carries `"url": ""`.
- Every response carries `Cache-Control: no-cache`, so `X-Firebase-ETag: true` plus
  `If-None-Match` is the only revalidation lever. The id lists are what it is worth using on.
- Feed list lengths are variable (500/500/200/55/137/31 observed for top/new/best/ask/show/job).
  Compute page counts from the list as fetched; never hardcode a count.
