---
name: record-hn-fixtures
description: Re-record the HN fixtures under e2e/fixtures/hn/ (firebase.json, algolia.json, manifest.json) by running scripts/record-hn-fixtures.ts against live HN. Reference for what the manifest guarantees and when a re-record is actually needed — not meant to be invoked from a prompt.
disable-model-invocation: true
---

# Recording HN fixtures

`e2e/fixtures/hn/{firebase,algolia,manifest}.json` are what `HN_SOURCE=fixture` serves —
`pnpm dev:e2e` and the `chromium` Playwright project (`.claude/rules/testing.md`). They are
recorded, not hand-written, and they are **committed**: the local e2e suite must not depend on
live HN being reachable or in any particular state.

## Running it

```
pnpm hn:record
```

Needs network access to the real Firebase and Algolia APIs — this is the one script in this repo
that is allowed to hit live HN outside of `e2e/live/**`. It overwrites all three files. Review the
diff before committing: `manifest.json` is small and worth reading in full; the two data files are
large and worth spot-checking (`git diff --stat`, and skim a few entries) rather than reading whole.

## What it does

`scripts/record-hn-fixtures.ts` drives the real `getFeed`, `getItem`, `getUser`, `getAuthorItems`
and `search` (from `server/hn`) through a transport that hits live HN and records every request,
via `server/hn/http.ts`'s `setTransport` seam. Two phases:

1. **Discovery** (unrecorded, plain live calls): picks a `deep` thread — 150-400 comments, at
   least one tombstoned comment, and a submitter with both a story and a comment in their Algolia
   history — and a `shallow` thread (5-30 comments) from the real `top` list. Finds the id of a
   tombstoned comment inside `deep`, and the author of the first comment in `deep`'s preorder that
   actually renders a byline. Verifies a search query (`deep`'s title, or a shorter prefix) returns
   at least one hit, and a random query returns none.
2. **Recording**: fetches and records exactly what the local e2e suite needs — no more, so the
   recorded set stays well under the 2MB budget the C6 chunk (`PLAN.md`) sets.

## The one deliberate deviation from "verbatim"

Every item, user and search body recorded is **verbatim** — the exact JSON HN returned. Feed
*lists* are the one exception: the recorded `topstories` body is a **selected and reordered**
60-id list — `deep` forced to rank 1, `shallow` also on page 1, and no other page-1 story
outweighing `deep` in `descendants` — not HN's real order. This is what lets specs open a
guaranteed-busy thread from the front page and assert on a recorded tombstone id without
depending on which real thread happens to be busiest on any given recording day. `new`, `best`,
`ask`, `show` and `job` are truncated to 30 ids (real order, no reordering) — plain pagination
fixtures, nothing to pin.

Because of this, the script fetches `top`'s page-1/page-2 items directly through
`firebase.getItem` rather than through `getFeed('top', …)` against an order it never uses — the
one place it doesn't literally "drive `getFeed`" for that reason.

## What the manifest guarantees (`e2e/hn-fixture.ts` reads this)

- `threads.deep` / `threads.shallow`: the two recorded thread ids, both reachable via `/item/:id`
  and both on the recorded `top` page 1.
- `tombstoneId`: a comment id inside `deep` that renders as a tombstone.
- `user`: `deep`'s submitter — has a profile and at least one story and one comment in their
  history (`all`/`story`/`comment` tabs all have rows).
- The profile and `all`-history of `deep`'s first rendered comment author are also recorded (not
  in the manifest by name — only `user` is), covering the "click a comment byline" flow.
- `search.query`: returns at least one story row. `search.emptyQuery`: returns none.
- `feeds`: how many ids were recorded per feed (`top` 60, i.e. two pages; the rest up to 30).

## When to re-record

- A spec starts asserting something the current fixtures don't cover (a new manifest field, a
  different thread shape).
- `e2e/hn-fixture.ts`'s `HnManifest` shape changes.
- The recorded fixtures start failing to reflect what `server/hn`'s current normalizers produce
  (e.g. after a schema change) — re-recording re-validates against live shapes since the script
  drives the real client/normalizer code, not a hand-rolled payload.

Not needed just because time has passed: an unrecorded URL fails loudly (`UpstreamError` → a 502
in the app, per `.claude/rules/testing.md`), so a stale-but-still-shaped fixture set is not a
silent risk the way a live flake would be.
