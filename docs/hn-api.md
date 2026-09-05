# Hacker News API reference

This document was mined on 2026-09-05 from the planning transcript for this repo
(`1554abf8-e75a-439c-a62c-2b281d6b7e33`, see [Provenance](#provenance)). That session fetched the
official docs and ran live probes against both APIs. **This file is the canonical HN API reference
for this repo — do not re-derive it from the live APIs.** Re-probing produces different numbers for
no gain, and the measured figures below are the ones the plan's decisions were made against.

Everything here traces to either (a) the upstream docs quoted in the transcript, (b) a live probe
run in that session on 2026-09-05, or (c) an assertion by the research agent that was not itself
probed. Assertions and derivations are labelled inline. Anything the transcript did not cover is
listed under [Not covered by the source transcript](#not-covered-by-the-source-transcript) rather
than filled in from memory.

## The two APIs at a glance

| | Firebase (official) | Algolia HN Search |
| --- | --- | --- |
| Base URL | `https://hacker-news.firebaseio.com/v0/` | `https://hn.algolia.com/api/v1/` |
| Auth | none | none |
| Comment tree | N+1, one request per item, authoritative | 1 request, fully nested |
| `kids` ordering | HN's ranked display order | not guaranteed to be HN's order (open question) |
| Live score / `descendants` | yes | subject to indexing lag |
| Comment `points` | absent | `null` |
| Search | none | the only option |
| Missing item | HTTP 200 + body `null` | proper 404 |
| Rate limit | none published | 10,000 requests/hour/IP |
| Caching headers | `Cache-Control: no-cache`; ETag opt-in via `X-Firebase-ETag: true` | none |
| Protocol observed | HTTP/1.1 | HTTP/2 (`alt-svc` advertises h3) |
| Content type | `application/json; charset=utf-8` | `application/json` |
| CORS | permissive, reflects `Origin` (`*` with no Origin) | reflects `Origin`, `vary: Origin` |

Both APIs are browser-callable. Neither takes an API key.

## Firebase API: endpoints

Base: `https://hacker-news.firebaseio.com/v0/`. Every endpoint is a plain `GET` returning JSON.
Append `?print=pretty` for pretty-printing (a Firebase REST param, not an HN feature).

| Endpoint | URL shape | Returns |
| --- | --- | --- |
| Item | `/v0/item/<id>.json` | item object, or `null` |
| User | `/v0/user/<id>.json` | user object, or `null` (id is case-sensitive) |
| Max item id | `/v0/maxitem.json` | a bare integer |
| Top stories | `/v0/topstories.json` | array of ids, up to 500; also contains jobs |
| New stories | `/v0/newstories.json` | array of ids, up to 500 |
| Best stories | `/v0/beststories.json` | array of ids (README states no cap; 200 observed) |
| Ask stories | `/v0/askstories.json` | array of ids, up to 200 |
| Show stories | `/v0/showstories.json` | array of ids, up to 200 |
| Job stories | `/v0/jobstories.json` | array of ids, up to 200 |
| Updates | `/v0/updates.json` | `{ "items": number[], "profiles": string[] }` |

The README's wording: *"Up to 500 top and new stories are at `/v0/topstories` (also contains jobs)
and `/v0/newstories`. Best stories are at `/v0/beststories`."* and *"Up to 200 of the latest Ask HN,
Show HN, and Job stories are at `/v0/askstories`, `/v0/showstories`, and `/v0/jobstories`."*

`HEAD` on an item URL returns **405 Method Not Allowed**. `POST` to an item URL returns **401** —
the database is read-only to the public. `OPTIONS` preflight returns 200 with
`Allow: OPTIONS,GET,POST,PUT,DELETE,PATCH`.

### Observed list lengths (live, 2026-09-05)

| List | Length |
| --- | --- |
| `topstories` | 500 |
| `newstories` | 500 |
| `beststories` | 200 |
| `askstories` | 55 |
| `showstories` | 137 |
| `jobstories` | 31 |

The ask/show/job lists are **variable-length and often well under 200** — do not assume a fixed
size. Compute page counts from the actual list length.

`updates.json` returned 61 items and 23 profiles in the same probe. Example shape from the README:

```json
{
  "items" : [ 8423305, 8420805, 8423379, 8422504, 8423178, 8423336, 8422717, 8417484 ],
  "profiles" : [ "thefox", "mdda", "plinkplonk", "GBond", "rqebmm", "neom", "arram" ]
}
```

(README's example lists 29 items and 32 profiles; truncated here.)

### `maxitem` and the id space

`maxitem` was **49,578,712** at probe time. Ids start at 1 and come from a single monotonically
increasing counter shared across all item types — stories, comments, jobs, polls and pollopts all
draw from it. Consequences:

- You **cannot infer type from an id**.
- Walking `maxitem` backward to find new stories means discarding the overwhelming majority as
  comments. The README describes exactly this: *"The newest page? Starts at item maxid and walks
  backward, keeping only the top level stories. Same for Ask, Show, etc."* (The research agent's
  "~90%+ discard" figure is an estimate, not a measurement.)
- Deleted items keep their ids; ids are dense.

### Versioning contract

From the README: *"For versioning purposes, only removal of a non-optional field or alteration of
an existing field will be considered incompatible changes. Clients should gracefully handle
additional fields they don't expect, and simply ignore them."*

Practical consequence for this repo: schemas over Firebase items should be non-strict/passthrough,
not `.strict()`.

## Firebase API: item shape

`GET /v0/item/<id>.json`. Only `id` is required; every other field is **optional and omitted
entirely** (not null) when absent.

| Field | Type | Required | README description |
| --- | --- | --- | --- |
| `id` | number | **yes** | The item's unique id. |
| `deleted` | boolean (`true` only) | no | `true` if the item is deleted. |
| `type` | `"job" \| "story" \| "comment" \| "poll" \| "pollopt"` | no | The type of item. |
| `by` | string | no | The username of the item's author. |
| `time` | number | no | Creation date of the item, in Unix Time. |
| `text` | string (HTML) | no | The comment, story or poll text. HTML. |
| `dead` | boolean (`true` only) | no | `true` if the item is dead. |
| `parent` | number | no | The comment's parent: either another comment or the relevant story. |
| `poll` | number | no | The pollopt's associated poll. |
| `kids` | number[] | no | The ids of the item's comments, in ranked display order. |
| `url` | string | no | The URL of the story. |
| `score` | number | no | The story's score, or the votes for a pollopt. |
| `title` | string (HTML) | no | The title of the story, poll or job. HTML. |
| `parts` | number[] | no | A list of related pollopts, in display order. |
| `descendants` | number | no | In the case of stories or polls, the total comment count. |

That table is the README's own list verbatim; `id` is the only field the README bolds as required.

Typing notes:

- `deleted` and `dead` appear **only as `true`**, never `false`. Model as `boolean | undefined`.
- `time` is **Unix seconds**, not milliseconds.
- `text` and `title` are HTML fragments with entity encoding — observed in the docs and probes:
  `&#x27;`, `<p>`, `<i>`, `<a href="…" rel="nofollow">`, `<pre><code>`. There is no plaintext
  variant, so sanitizing/parsing is mandatory.
- `descendants` is the **total subtree comment count**, not `kids.length`. `kids` is direct
  children only.
- `kids` order is HN's ranked display order — preserve it; do not sort by id or time.
- A missing item returns HTTP **200** with body `null`, not a 404. Same for a missing user. Any
  wrapper API must map `null` to 404 itself.

### Fields per item type

Derived from the README's canonical examples. This is what those specific examples contain, which
is evidence of what each type typically carries — not a guarantee that no other field can appear.

| Type | Example | Fields present in the example |
| --- | --- | --- |
| story | `item/8863` | `by, descendants, id, kids, score, time, title, type, url` |
| story (Ask HN) | `item/121003` | `by, descendants, id, kids, score, text, time, title, type` — **no `url`**, has `text` |
| comment | `item/2921983` | `by, id, kids, parent, text, time, type` — no `score`, `title`, `descendants`, `url` |
| job | `item/192327` | `by, id, score, text, time, title, type, url` — has `score`, no `descendants`, no `kids` |
| poll | `item/126809` | `by, descendants, id, kids, parts, score, text, time, title, type` |
| pollopt | `item/160705` | `by, id, poll, score, text, time, type` — `score` = votes for that option |

There is **no `"ask"` or `"show"` item type**. Ask HN and Show HN posts are `type: "story"`,
distinguished only by the title prefix.

The README's job example has `"url": ""` — an empty string, not an absent field. Job items may
carry `text` instead of a real `url`.

Verbatim story example (`/v0/item/8863.json?print=pretty`):

```json
{
  "by" : "dhouston",
  "descendants" : 71,
  "id" : 8863,
  "kids" : [ 8952, 9224, 8917, 8884, 8887, 8943, 8869, 8958, 9005, 9671, 8940, 9067, 8908,
             9055, 8865, 8881, 8872, 8873, 8955, 10403, 8903, 8928, 9125, 8998, 8901, 8902,
             8907, 8894, 8878, 8870, 8980, 8934, 8876 ],
  "score" : 111,
  "time" : 1175714200,
  "title" : "My YC app: Dropbox - Throw away your USB drive",
  "type" : "story",
  "url" : "http://www.getdropbox.com/u/2/screencast.html"
}
```

Verbatim comment example (`/v0/item/2921983.json?print=pretty`):

```json
{
  "by" : "norvig",
  "id" : 2921983,
  "kids" : [ 2922097, 2922429, 2924562, 2922709, 2922573, 2922140, 2922141 ],
  "parent" : 2921506,
  "text" : "Aw shucks, guys ... you make me blush with your compliments.<p>Tell you what, Ill make a deal: I'll keep writing if you keep reading. K?",
  "time" : 1314211127,
  "type" : "comment"
}
```

Verbatim poll example (`/v0/item/126809.json?print=pretty`), showing `parts`:

```json
{
  "by" : "pg",
  "descendants" : 54,
  "id" : 126809,
  "kids" : [ 126822, 126823, 126993, 126824, 126934, 127411, 126888, 127681, 126818 ],
  "parts" : [ 126810, 126811, 126812 ],
  "score" : 46,
  "text" : "",
  "time" : 1204403652,
  "title" : "Poll: What would happen if News.YC had explicit support for polls?",
  "type" : "poll"
}
```

(`kids` truncated here; the README lists 25.) And one of its parts (`/v0/item/160705.json`):

```json
{
  "by" : "pg",
  "id" : 160705,
  "poll" : 160704,
  "score" : 335,
  "text" : "Yes, ban them; I'm tired of seeing Valleywag stories on News.YC.",
  "time" : 1207886576,
  "type" : "pollopt"
}
```

Poll handling therefore needs: read `parts` in order, fetch each pollopt, render its `text` and use
its `score` as the vote count. Note `poll` on the pollopt points back at its poll, and in the
README's example that back-pointer (`160704`) is a *different* poll from the one shown above.

### Deleted and dead tombstones

Both were captured live by walking backward from `maxitem`.

Deleted comment:

```json
{"deleted":true,"id":49578685,"parent":49576305,"time":1788629312,"type":"comment"}
```

Dead comment:

```json
{"by":"flaviopilotodas","dead":true,"id":49578709,"parent":49578708,"text":"[flagged]","time":1788629415,"type":"comment"}
```

What survives:

- A **`deleted`** item loses `by`, `text` and `kids` entirely. It keeps `id`, `parent`, `time`,
  `type`, plus `deleted: true`.
- A **`dead`** item keeps `by` and `text` (the observed text was literally `[flagged]`) and,
  per the research agent, can still have `kids` — the captured example had none, so treat "dead
  items can have kids" as an agent assertion.
- Critically: **a deleted item's id still appears in its parent's `kids` array.** A renderer must
  handle "child exists in `kids` but is a tombstone" rather than assuming every kid is renderable.

## Firebase API: user shape

`GET /v0/user/<id>.json`. Only users with public activity (comments or story submissions) are
available.

| Field | Type | Required | README description |
| --- | --- | --- | --- |
| `id` | string | **yes** | The user's unique username. Case-sensitive. |
| `created` | number | **yes** | Creation date of the user, in Unix Time. |
| `karma` | number | **yes** | The user's karma. |
| `about` | string (HTML) | no | The user's optional self-description. HTML. |
| `submitted` | number[] | no | List of the user's stories, polls and comments. |

Example (`/v0/user/jl.json?print=pretty`), `submitted` truncated:

```json
{
  "about" : "This is a test",
  "created" : 1173923446,
  "id" : "jl",
  "karma" : 2937,
  "submitted" : [ 8265435, 8168423, 8090946, 8090326, 7699907, 7637962, 7596179 ]
}
```

`submitted` can be very large for prolific users (the README's `jl` example already lists ~250 ids).
A missing user returns HTTP 200 with `null`.

## Firebase API: caching, ETags, CORS, rate limits

**Rate limits.** The README says, under "URI and Versioning": *"There is currently no rate limit."*
No documented quota, and the probe found **no `X-RateLimit-*` headers**. That Firebase will throttle
abusive traffic anyway is the research agent's expectation, not a measured fact.

**Caching.** Every response carries `Cache-Control: no-cache`. No `Expires`, no `Last-Modified`, no
`Age`. There is no free CDN caching semantics to lean on — a client or proxy owns its own cache
layer entirely.

Observed response headers on `GET /v0/item/8863.json`:

```
HTTP/1.1 200 OK
Server: nginx
Content-Type: application/json; charset=utf-8
Content-Length: 375
Connection: keep-alive
access-control-allow-origin: https://example.com
Cache-Control: no-cache
Strict-Transport-Security: max-age=31556926; includeSubDomains; preload
```

**ETags — opt-in via a Firebase-specific request header.** This is the one revalidation mechanism
available, and it is not on by default:

1. Send `X-Firebase-ETag: true` on the request. The response then includes
   `ETag: uQwfy4Z5EPt1ZzmynXeT2oDuKGk=` and `Access-Control-Expose-Headers: ETag`.
2. Send that value back as `If-None-Match: <etag>`. The response is **`304 Not Modified`** with
   `Content-Length: 0`.
3. The probe found that `If-None-Match` returns 304 **even without** repeating
   `X-Firebase-ETag: true` on the conditional request — the opt-in header is only needed to
   *obtain* the ETag in the first place.

Both the 200-with-ETag and the 304 still carry `Cache-Control: no-cache`.

This is the practical lever for a caching proxy: revalidate `maxitem`, the story-id lists, and
immutable old items with 304s instead of full bodies.

**CORS.** Fully permissive. With `Origin: https://example.com` the response reflects it in
`access-control-allow-origin`; with no `Origin` header the value is `*`. Preflight `OPTIONS` returns
200 and `Access-Control-Allow-Methods: OPTIONS,GET,POST,PUT,DELETE,PATCH`. A browser can call this
API directly — a server-side wrapper's value is aggregation and caching, not CORS proxying.

**No batch fetch. Confirmed.** There is no multi-get, no `ids=` parameter, no GraphQL. `POST` to an
item URL returns 401. One HTTP request per item, always. The README states the design plainly:
*"Want to know the total number of comments on an article? Traverse the tree and count. Want to know
the children of an item? Load the item and get their IDs, then load them."* — and, candidly,
*"I'm not saying this to defend it - It's not the ideal public API, but it's the one we could release
in the time we had."*

The endpoint negotiated **HTTP/1.1** in the probe, not h2, so there is no h2 multiplexing to lean
on. Connection reuse (keep-alive with a healthy socket pool) is the only transport-level mitigation.

### Undocumented Firebase REST parameters

These are not in the HN README, but the endpoint is a real Firebase RTDB and the session confirmed
they work. Treat them as unsupported — they can break without notice.

- **Deep paths.** `/v0/item/8863/title.json` → `"My YC app: Dropbox - Throw away your USB drive"`;
  `/v0/item/8863/kids/0.json` → `9224`; `/v0/topstories/30.json` → a single id. Lets you fetch one
  field instead of a whole item.
- **`?shallow=true`.** `/v0/item/8863.json?shallow=true` →
  `{"url":true,"score":true,"id":true,"descendants":true,"by":true,"kids":true,"time":true,"title":true,"type":true}`
  — keys only. A cheap way to probe which fields exist.
- **Server-side slicing.** `/v0/topstories.json?orderBy="$key"&startAt="30"&endAt="59"` returns a
  **dict** (`{"30":49554643,"31":49571047,"32":49575034,…}`, 30 entries) rather than an array.
  `?orderBy="$key"&limitToFirst=3` → `[49578310,49576386,49570669]` (an array, when starting at 0).
  Caveat: `$key` orders **lexicographically**, so `"10" < "2"`, which makes `startAt`/`endAt` paging
  past index 9 unreliable across magnitude boundaries. Fetching the full 500-id list once and
  slicing server-side is safer.

## The N+1 problem, measured

This is the defining characteristic of the Firebase API. `descendants` tells you the total comment
count but there is no way to fetch a subtree — you must BFS/DFS: load the story, read `kids`, load
each kid, read its `kids`, recurse. (The claim that busy threads commonly run 8–15 levels deep is
the research agent's estimate, not a measurement from this session.)

**Measured live on 2026-09-05, for the then-current top 30 stories:**

- `descendants` per story, descending:
  `[1460, 445, 381, 314, 260, 197, 197, 188, 188, 182, 119, 119, 113, 113, 71, 41, 40, 39, 31, 31,
  24, 13, 11, 8, 5, 5, 4, 3, 3, 0]`
- Total comments across the top 30: **4,605**
- Front page plus every full comment tree: `1 + 30 + 4,605` = **4,636 HTTP requests**
- The single busiest front-page story, with **1,460 comments**, is **1,461 requests** on its own
- Front-page metadata only (no comments): **31 requests** (1 list + 30 items)

**Measured latency (from a laptop, not a datacenter):**

- Single item (`item/8863.json`), 5 samples: `0.106, 0.123, 0.128, 0.115, 0.096` s — so ~0.10–0.13s
- `topstories.json` (500 ids): `0.102` s
- Algolia `items/8863`: `0.325` s, `41,342` bytes

Derived, not measured: 4,636 sequential requests at ~0.10s is roughly 8 minutes; at a concurrency of
50, roughly 10s. Concurrency control plus caching is mandatory. Likewise the plan's "31 requests,
well under 200ms" for a feed page is a derivation from the per-item latency above (30 items fetched
in parallel), not a timed end-to-end measurement.

**The comparison that reframes the design:** `items/8863` from Algolia returned the whole tree in
one request — 0.33s, 41KB. The same tree via Firebase is 72 requests (1 story + its 71
`descendants`; that count comes from the README's example payload, not from a re-probe of 8863). For
the 1,460-comment thread it is 1 request versus 1,461.

## Firebase API: other gotchas

- HTTP 200 with a `null` body for missing items and users — easy to mis-type as a valid item and
  crash on.
- `topstories` includes **job posts** (the README says so explicitly), so `type` is not uniformly
  `"story"` in that list.
- `topstories` order is *close to* but not identical to the rendered front page. Compared live:
  front page ids `[49578310, 49576386, 49570669, 49563355, 49571634, 49575150, 49577975, 49568506]`
  versus `topstories` `[49578310, 49576386, 49570669, 49563355, 49571634, 49575150, 49568506,
  49577975]` — positions 7 and 8 are **swapped**. Ranking drift between the API snapshot and the
  HTML render is normal within the same second; do not expect byte-identical ordering.
- `text` is HTML with no length limit and no plaintext field.

## Algolia HN Search API

Base: `https://hn.algolia.com/api/v1/`. The docs at <https://hn.algolia.com/api> are client-rendered;
the session extracted the doc component's text out of
`https://hn.algolia.com/public/main-6e634771f729331a3c3c.js`. The docs still show `http://` URLs —
**HTTPS works and negotiates h2**. Source repo: <https://github.com/algolia/hn-search>.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/items/:id` | Item **with its full comment tree nested** |
| `GET /api/v1/users/:username` | User profile |
| `GET /api/v1/search?query=...` | Search, sorted by relevance, then points, then number of comments |
| `GET /api/v1/search_by_date?query=...` | Search, sorted by date, most recent first |
| `GET /popular.json` | Used by the site's own UI; undocumented |

A missing item returns a proper **404** — unlike Firebase's `200 null`.

### Query parameters

The docs table lists exactly four:

| Parameter | Description | Type |
| --- | --- | --- |
| `query=` | full-text query | String |
| `tags=` | filter on a specific tag | String |
| `numericFilters=` | filter on a numerical condition (`<`, `<=`, `=`, `>`, `>=`) | String |
| `page=` | page number (0-indexed) | Integer |

`numericFilters` available numerical fields: **`created_at_i`, `points`, `num_comments`**.

`hitsPerPage` is **not** in the docs' parameter table — the docs describe `nbPages` and
`hitsPerPage` as response variables that *"can be specified as arguments in requests, allowing for
more results to be requested or iteration over the available pages eg appending to the search URL
parameters like `&page=2` or `hitsPerPage=50`."* It was verified working live. The docs also note
that the complete list of Algolia search parameters applies, so arbitrary Algolia params work —
`restrictSearchableAttributes=url` appears in the documented examples, and `advancedSyntax=true`
appears in the `params` echoed back by a live response.

### Tag vocabulary and AND/OR

Available tags, from the docs: `story`, `comment`, `poll`, `pollopt`, `show_hn`, `ask_hn`,
`front_page`, `author_:USERNAME`, `story_:ID`.

Combination semantics, verbatim from the docs: *"Tags are ANDed by default, can be ORed if between
parenthesis. For example `author_pg,(story,poll)` filters on `author=pg AND (type=story OR
type=poll)`."*

So: comma = AND; parentheses around a comma-separated group = OR within the group.

### Documented examples (verbatim)

```
All stories matching foo                /api/v1/search?query=foo&tags=story
All comments matching bar               /api/v1/search?query=bar&tags=comment
All URLs matching bar                   /api/v1/search?query=bar&restrictSearchableAttributes=url
Stories on the front/home page now      /api/v1/search?tags=front_page
Last stories                            /api/v1/search_by_date?tags=story
Last stories OR polls                   /api/v1/search_by_date?tags=(story,poll)
Comments since timestamp X (seconds)    /api/v1/search_by_date?tags=comment&numericFilters=created_at_i>X
Stories between X and Y (seconds)       /api/v1/search_by_date?tags=story&numericFilters=created_at_i>X,created_at_i<Y
Stories of pg                           /api/v1/search?tags=story,author_pg
Comments of story X                     /api/v1/search?tags=comment,story_X
```

### Search response envelope

Documented top-level fields: `hits`, `page`, `nbHits`, `nbPages`, `hitsPerPage`, `processingTimeMS`,
`query`, `params`.

Live response (`?tags=front_page`) additionally carried, undocumented: `exhaustive`
(`{nbHits, typo}`), `exhaustiveNbHits`, `exhaustiveTypo`, `serverTimeMS`, `processingTimingsMS`.
That probe returned `nbHits: 30`, `hitsPerPage: 20`, `nbPages: 2`, and echoed
`params: tags=front_page&advancedSyntax=true&analyticsTags=backend`.

**Default `hitsPerPage` is 20.**

### Hit fields

Story hit keys, live (`?tags=front_page`):

| Field | Notes |
| --- | --- |
| `objectID` | **string** — the HN id rendered as a string |
| `title` | |
| `url` | |
| `author` | |
| `points` | number |
| `story_text` | `null` on link stories |
| `num_comments` | number |
| `created_at` | ISO 8601 string |
| `created_at_i` | Unix seconds |
| `updated_at` | ISO 8601 string |
| `children` | number[] of comment ids |
| `story_id` | |
| `_tags` | string[], e.g. `["story","author_Sikul","story_22238335"]` |
| `_highlightResult` | per-field highlight object |

Comment hit keys, live (`?tags=comment&hitsPerPage=1`): `objectID`, `comment_text`, `author`,
`parent_id`, `story_id`, `story_title`, `story_url`, `points`, `created_at`, `created_at_i`,
`updated_at`, `children`, `_tags`, `_highlightResult`.

**`points` on comment hits is `null`** — confirmed live. There is no comment score available from
Algolia at all; Firebase does not expose one either.

The research agent described story-hit `children` as "all descendant ids, flat". That was an
assertion; the probes show `children` is an array of ids but did not verify whether it is all
descendants or only direct children. Do not rely on either reading without checking.

`_highlightResult` is keyed per field, each value shaped
`{ value, matchLevel: "none"|"partial"|"full", matchedWords: string[], fullyHighlighted?: boolean }`,
with `<em>` wrapping matches in `value` — usable directly for search snippets. Live sample:

```json
{
  "title": {
    "fullyHighlighted": false,
    "matchLevel": "full",
    "matchedWords": ["rust"],
    "value": "Why Discord is switching from Go to <em>Rust</em>"
  }
}
```

Verbatim comment hit (`?tags=comment&hitsPerPage=1`):

```json
{"_tags":["comment","author_tcas","story_9998227"],"author":"tcas","children":[10000042],
 "created_at":"2015-08-03T21:32:01Z","created_at_i":1438637521,"objectID":"9999999",
 "parent_id":9999826,"points":null,"story_id":9998227,
 "story_title":"Why Write Python in Visual Studio?",
 "story_url":"http://blogs.msdn.com/b/visualstudio/archive/2015/08/03/why-write-python-in-visual-studio.aspx",
 "updated_at":"2023-09-07T03:22:05Z"}
```

### Pagination ceiling: 1,000 hits

`hitsPerPage=1000` was verified to return 1,000 hits. But `?tags=story&page=100` returns an error:

> *"you can only fetch the 1000 hits for this query. You can extend the number of hits returned via
> the paginationLimitedTo index parameter or use the browse method."*

So **1,000 hits maximum per query**. Deeper traversal requires slicing the result set by
`created_at_i` ranges with `numericFilters` and issuing multiple queries.

### `/api/v1/items/:id` — the nested comment tree

Fields observed live on `items/8863`: `id` (number), `created_at` (ISO string), `created_at_i`,
`type`, `author`, `title`, `url`, `text`, `points`, `parent_id`, `story_id`, `options` (array),
`children` (**recursively nested array of the same object shape**).

On the root, `parent_id` and `text` were `null` and `points` was a number. On a child, `parent_id`
and `text` were populated while `points`, `title` and `url` were all `null`, and the child carried
its own `children` array — so the shape is uniform between root and descendants, with type-dependent
nulls rather than absent keys. `options` was present (an array) on both.

The docs' own illustrative payload shows the same recursion — an item with `children`, each child
having `parent_id` pointing at its parent and its own `children`, bottoming out at `children: []`.

Measured: `items/8863` → **0.325s, 41,342 bytes**, one request, versus 72 Firebase requests for the
same tree. **This is the single most important fact about the Algolia API for this repo.**

### `/api/v1/users/:username`

Much thinner than Firebase's user record. Live for `pg`:

```json
{
    "about": "Bug fixer.",
    "karma": 157316,
    "username": "pg"
}
```

Only `username`, `about`, `karma`. **No `created`, no `submitted`.** (The docs' illustrative payload
types `karma` as a string, `99999`; the live response returns a number.) For account age use
Firebase `user/:id`; for submission history use Algolia `tags=author_X`.

### Rate limits

Verbatim from the docs:

> *"We are limiting the number of API requests from a single IP to 10,000 per hour. If you or your
> application has been blacklisted and you think there has been an error, please contact us."*
> (`mailto:support@algolia.com?subject=HN Search: rate limit`)

10,000/hour/IP. No `X-RateLimit-*` headers are returned, so the limit is discovered by being
blocked. A server behind a single NAT egress IP shares that budget across all concurrent work —
which is the argument for caching aggressively rather than proxying per-user traffic.

### Caching and CORS

Live headers on `GET /api/v1/search?query=rust&tags=story`:

```
HTTP/2 200
content-type: application/json
access-control-allow-origin: https://example.com
vary: Origin
x-cloud-trace-context: ada317f0e9c90672c13516730d38b905
server: Google Frontend
via: 1.1 google
alt-svc: h3=":443"; ma=2592000,h3-29=":443"; ma=2592000
```

**No `Cache-Control`, no `ETag`, no `Last-Modified`.** The caller owns caching entirely, with no
revalidation mechanism at all (unlike Firebase's opt-in ETag).

### Indexing configuration (from the hn-search repo)

Useful context for how relevance behaves. From `github.com/algolia/hn-search`'s `Item` model:

- Indexed attributes: `created_at`, `title`, `url`, `author`, `points`, `story_text`,
  `comment_text`, `num_comments`, `story_id`, `story_title`, plus a computed `created_at_i`.
- `attributesToIndex ['unordered(title)', 'unordered(story_text)', 'unordered(comment_text)',
  'unordered(url)', 'author', 'created_at_i']` — the repo's comment: *"`title` is more important
  than `{story,comment}_text`, `{story,comment}_text` more than `url`, `url` more than `author`"*,
  and position within a field is deliberately ignored to avoid a first-word match boost.
- `attributesToHighlight ['title', 'story_text', 'comment_text', 'url', 'story_url', 'author',
  'story_title']`.
- `tags do [item_type, "author_#{author}", "story_#{story_id}"] end` — which is exactly the `_tags`
  array seen on live hits.
- `customRanking ['desc(points)', 'desc(num_comments)']`, `ranking ['typo', 'proximity',
  'attribute', 'custom']`. The repo notes the `exact` criterion was deliberately removed.
- `separatorsToIndex '+#$'` — so `google+`, `$1.5M`, `C#` are searchable.
- `story_text` is null for comments; `comment_text` is null for non-comments; `story_title` and
  `story_url` are populated on comments from the parent story.

### Indexing lag

The research agent lists "indexing lag behind live HN" as an Algolia downside and a reason to take
`score`/`descendants` from Firebase. **This was never measured in the session** — no lag figure
exists. Treat the direction as plausible and the magnitude as unknown.

## Open question: does Algolia preserve HN's ranked comment order at depth?

**This is open. Do not answer it from this document, and do not assume either way.**

Firebase's `kids` is documented as "in ranked display order". Algolia's nested `children` ordering
is not documented and was not verified in the session. The plan this document feeds resolves it with
an explicit spike in Epoch 1: compare one live busy thread's Algolia `children` ordering at depth > 1
against the `news.ycombinator.com` HTML rendering. If Algolia's ordering is wrong at depth, the
comment source default flips to Firebase.

Until that spike runs, the design assumption is: build the tree from Algolia, but order the **top
level** by Firebase's `kids`, and take live `score`/`descendants` from Firebase.

## HN's own pagination, and mapping it onto `topstories`

Verified live against `news.ycombinator.com`:

- `https://news.ycombinator.com/news` renders **exactly 30 stories** (counted 30
  `athing submission` rows).
- `https://news.ycombinator.com/news?p=2` starts at `<span class="rank">31`, then 32, 33. So `p` is
  **1-indexed** and page *p* covers ranks `(p-1)*30 + 1` through `p*30`.
- `?p=6` ends at rank **180**. `?p=7` and `?p=17` each still return 30 stories, so the ranked pool
  extends well past 180.
- The same 30-per-page convention applies to `/newest`, `/ask`, `/show`, `/front` (asserted by the
  research agent from the same structure; only `/news` was counted directly).

URL shapes on news.ycombinator.com seen in the session: `/news`, `/news?p=N`, `/newest`, `/ask`,
`/show`, `/front`, and `/item?id=N` for a single item.

Mapping onto `topstories`:

- `topstories.json` returns up to 500 ids in rank order, so HN page *p* is approximately
  `topstories.slice((p-1)*30, p*30)`.
- 500 ÷ 30 = **16 full pages plus a 17th of 20**. Pages 1–17 can all be served from a single
  `topstories.json` fetch; beyond that the API simply does not expose the ranking, and HTML scraping
  would be the only option.
- Caveats:
  1. `topstories` includes **job posts**, which HN interleaves at specific ranks. Filtering jobs out
     makes page boundaries drift from vanilla HN's.
  2. Ranking is recomputed continuously, so an API snapshot can disagree with a concurrently
     rendered HTML page — positions 7 and 8 were observed swapped within the same second.
  3. Vanilla HN's `?p=` re-renders from live ranking on every request, so a story can appear on two
     pages or none as it moves. Stable pagination requires snapshotting the 500-id list per
     session/TTL and paging over the snapshot.
- The other lists cap lower: `beststories` (200 observed) → ~7 pages; ask/show/job are variable
  (55/137/31 observed) → ~2/5/2 pages. Page counts should be computed from the real list length, not
  hardcoded.

## Choosing between the two

- **Firebase** is authoritative and near-real-time: `updates` and `maxitem` for change detection,
  canonical ranked `kids`, the full user record with `created` and `submitted`, live vote counts.
- **Algolia** is the only search option, returns whole comment trees in one call, has the
  `front_page` tag, supports time-range queries and author history. Its costs: indexing lag,
  `points: null` on comments, comment ordering not known to match HN's, the 1,000-hit pagination
  ceiling, and it is a third party that can fail independently of HN.
- The hybrid the plan adopts: `topstories` plus per-item metadata from Firebase (with ETag
  revalidation) for feeds; Algolia `items/:id` for comment trees, with a Firebase BFS fallback
  behind a source seam; Algolia for search.

## Not covered by the source transcript

Listed so no future reader mistakes absence for non-existence. These were in scope for this
document but the transcript has nothing probe-backed to say:

- **Algolia `children` semantics on search hits** — whether it is all descendants (flat) or direct
  children only. Asserted as flat-all-descendants, never verified.
- **Algolia indexing lag** — no measured figure, no upper bound.
- **Algolia `children` ordering at depth** — the open question above; deliberately unresolved.
- **Whether Algolia exposes `deleted`/`dead` items**, and how tombstones appear in
  `items/:id` trees or search hits. Not probed.
- **HTML escaping of Algolia's `story_text` / `comment_text`** relative to Firebase's `text`.
  Not compared.
- **`/popular.json`** — noted as used by the site's UI and undocumented; its shape was not probed.
- **Firebase realtime/streaming** — the README points at Firebase client libraries and change
  notifications, and `updates.json` was probed, but no polling interval, SSE/`EventSource`, or
  streaming behaviour was tested.
- **Recommended `updates.json` poll frequency** and how far behind live it runs.
- **Actual comment tree depth distribution** — the "8–15 levels" figure is an agent estimate.
- **Whether `beststories` has a documented cap** — the README states none; 200 was observed.
- **Algolia `pollopt` / `poll` hit shapes** — the tags exist but no poll hit or poll `items/:id`
  response was captured; poll coverage above is Firebase-only.
- **Rate-limit behaviour on breach** (status code, `Retry-After`) for either API. Neither was
  pushed to its limit.
- **Firebase `submitted` pagination** — no mechanism found or looked for; the field is returned
  whole.
- **Algolia `search` vs `search_by_date` `nbHits` consistency**, and whether `front_page` reflects
  the same 30 items HN renders.

## Provenance

Mined on **2026-09-05** from the Claude Code planning transcript:

- `/Users/tyler/.claude/projects/-Users-tyler-repos-yahn-ty-ler-dev/1554abf8-e75a-439c-a62c-2b281d6b7e33.jsonl`
- The research itself lives in that session's subagent transcript,
  `.../1554abf8-e75a-439c-a62c-2b281d6b7e33/subagents/agent-a96e8b100b370bd68.jsonl`
  (agent type `Explore`, description "Research HN official API"), whose final report and raw
  `curl`/`python3` probe output are the primary source for everything above.

Upstream sources that session consulted:

- <https://github.com/HackerNews/API> — README, fetched raw from
  `https://raw.githubusercontent.com/HackerNews/API/master/README.md`
- `https://hacker-news.firebaseio.com/v0/` — live probes: headers, item/user shapes, ETag
  behaviour, list lengths, latency, `maxitem`, deleted/dead tombstones
- <https://hn.algolia.com/api> — docs, extracted from
  `https://hn.algolia.com/public/main-6e634771f729331a3c3c.js`
- <https://github.com/algolia/hn-search> — README and indexing configuration
- `https://news.ycombinator.com/news?p=N` — live pagination verification

All "live", "observed" and "measured" values in this document are as of 2026-09-05 and will have
drifted. They are recorded because the orders of magnitude are what the architecture depends on, not
because the exact numbers still hold.
