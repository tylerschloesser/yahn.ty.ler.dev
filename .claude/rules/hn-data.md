---
paths:
  - "server/hn/**"
---

# The HN data layer

Loaded when you touch `server/hn/`.

**Read `docs/hn-api.md` first.** It is the complete, mined API reference — every endpoint, every
field per item type, the tombstone shapes, measured latencies and request counts. Do not
re-derive any of it from the live APIs, and do not write a field list from memory.

## Two APIs, and why both

- **Firebase** (`hacker-news.firebaseio.com/v0`) is authoritative: live `score`/`descendants`,
  and `kids` in HN's ranked display order. It has **no batch fetch** — one HTTP request per item,
  always. A front page plus every full comment tree measured **4,636 requests**.
- **Algolia** (`hn.algolia.com/api/v1`) returns an entire comment tree already nested in one
  request and is the only search option. It lags indexing, returns `points: null` on comments,
  and caps pagination at 1,000 hits. **10,000 requests/hour/IP**, no `X-RateLimit-*` headers.

## Comment ordering: the spike's answer

**Algolia does not preserve HN's ranked order — at any depth.** Its nested `children` arrays are
strictly ascending by id (chronological), measured against four live front-page threads: 195 of
195 multi-entry arrays were strictly ascending. Firebase `kids` agreed with HN's displayed order.
**`getCommentSource()` defaults to `firebase`.** `hybrid` (`COMMENT_SOURCE=hybrid`) still exists
as a fallback for when Algolia is the only thing that answers, but it is not the default: it
trades one round trip for wrong sibling order everywhere.

## Concurrency and the node cap, measured on Vercel

`HN_TREE_CONCURRENCY=128` and `HN_TREE_NODE_CAP=2000` are the defaults, both env-tunable — carried
over unchanged (S2). Re-measured against a real Vercel function, 10 interleaved sequential
requests each: thread 36245435 (1,609 comments) median 2.79s / max 6.49s; 47687273 (509) 1.32s /
2.24s; 38309611 (2,530, capped at 2,000) 2.03s / 2.47s; peak RSS 293MB. Three concurrent requests
on separate Fluid instances took 4.4s each; c=32 gave a 3.61s median, c=256 gave 2.55s (n=3). No
errors or 429s. Vercel's function ceiling here is 300s, so the worst case measured (6.5s) has wide
headroom — measured, not assumed, because tail latency on this endpoint is real: any future
comparison on it needs many interleaved samples, since three-of-each is inside the noise.

## Invariants

- `kids` is HN's ranked display order. **Never sort by id or time** — that is exactly the bug the
  spike found in Algolia.
- `descendants` is the total subtree count, not `kids.length`. Pass it through; never compute it.
- A missing item is HTTP **200 with a `null` body**, not a 404. Mapping that to `NotFoundError` is
  this layer's job.
- `deleted` and `dead` only ever appear as `true`, never `false`. A deleted item loses `by`,
  `text` and `kids`; a dead one keeps `by` and `text`. **A deleted item's id still appears in its
  parent's `kids`** — a tree walk must tolerate a tombstone child.
- An empty-string `url` is not a url.
- Every response carries `Cache-Control: no-cache`, so `X-Firebase-ETag`/`If-None-Match` is the
  only revalidation lever. `HN_SOURCE=fixture` ignores `If-None-Match` entirely and always serves
  the recorded body — it is a transport swap under `fetchJson`, not a mock of this layer's logic.
- Feed list lengths are variable (500/500/200/55/137/31 observed for top/new/best/ask/show/job).
  Compute page counts from the list as fetched; never hardcode a count.
