/**
 * Records real Hacker News responses into `e2e/fixtures/hn/{firebase,algolia}.json`,
 * plus the `manifest.json` the local e2e suite reads (`e2e/hn-fixture.ts`).
 * Run with `pnpm hn:record`; see `.claude/skills/record-hn-fixtures/SKILL.md`
 * for when to re-record.
 *
 * Two phases:
 *
 * 1. **Discovery** — plain, unrecorded live calls through the real
 *    `server/hn` functions (`setTransport` is not called yet, so
 *    `env.hnSource`'s default `'live'` path runs exactly like production).
 *    Finds:
 *      - `deep`: a real top-list story with 150-400 comments and at least
 *        one tombstoned comment, whose submitter has both a story and a
 *        comment in their Algolia history;
 *      - `shallow`: a real top-list story with 5-30 comments;
 *      - the tombstoned comment id inside `deep`;
 *      - the author of the first comment in `deep`'s preorder that actually
 *        renders a byline (skipping tombstones, recursing into their
 *        children — a tombstoned parent can still have real replies);
 *      - a search query (deep's title, or a shorter prefix of it) verified
 *        to return at least one hit, and a query verified to return none.
 *
 * 2. **Recording** — `setTransport` (`server/hn/http.ts`'s seam) is set to a
 *    transport that hits the same live hosts and records every request into
 *    an in-memory map, then drives exactly the calls the local e2e suite
 *    needs — no more, so the recorded set stays small. `getFeed`, `getItem`,
 *    `getUser`, `getAuthorItems` and `search` (the real functions) drive all
 *    of it, **except** `top`'s per-item fetches: `top` is recorded as a
 *    *selected and reordered* list (`deep` at rank 1, so the front page
 *    always opens deep's thread; `shallow` also on page 1; no other page-1
 *    story outweighs `deep`) rather than HN's real order, so its items are
 *    fetched directly through `firebase.getItem` instead of through
 *    `getFeed` against an order this recording does not use. `PLAN.md`'s C6
 *    chunk (amended at G1) permits this deviation for feed lists only —
 *    every item, user and search body recorded is verbatim.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  firebase,
  getAuthorItems,
  getFeed,
  getItem,
  getUser,
  mapWithConcurrency,
  search,
} from '../server/hn/index.js'
import { fixtureKey, isFirebaseUrl } from '../server/hn/fixture/transport.js'
import type { FirebaseItem } from '../server/hn/firebase/types.js'
import { setTransport } from '../server/hn/http.js'
import type { Comment, FeedName } from '../shared/schema/index.js'
import { PAGE_SIZE } from '../shared/schema/index.js'

const FEED_ENDPOINTS: Record<FeedName, string> = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
  job: 'jobstories',
}

const TOP_FEED_COUNT = PAGE_SIZE * 2 // two pages, so pagination has somewhere to go
const DEEP_RANGE: [number, number] = [150, 400]
const SHALLOW_RANGE: [number, number] = [5, 30]

function log(message: string): void {
  console.log(`[record-hn-fixtures] ${message}`)
}

// Preorder DFS over the rendered comment tree: visit a comment, then its
// children, then the next sibling. Mirrors what the thread page actually
// renders top-to-bottom.
function firstAuthor(comments: readonly Comment[]): string | null {
  for (const comment of comments) {
    if (comment.by) return comment.by
    const found = firstAuthor(comment.children)
    if (found) return found
  }
  return null
}

function firstTombstone(comments: readonly Comment[]): number | null {
  for (const comment of comments) {
    if (comment.deleted) return comment.id
    const found = firstTombstone(comment.children)
    if (found !== null) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// Phase 1: discovery (unrecorded — no transport override set yet)
// ---------------------------------------------------------------------------

log('discovery: fetching the real top story id list...')
const realTopIds = await firebase.getStoryIds('top')

async function exploreTopItems(count: number): Promise<Map<number, FirebaseItem>> {
  const ids = realTopIds.slice(0, count)
  const fetched = await mapWithConcurrency(ids, 40, async (id) => {
    try {
      return await firebase.getItem(id)
    } catch {
      return undefined
    }
  })
  const map = new Map<number, FirebaseItem>()
  ids.forEach((id, i) => {
    const item = fetched[i]
    if (item) map.set(id, item)
  })
  return map
}

function inRange(item: FirebaseItem | undefined, [min, max]: [number, number]): boolean {
  if (!item) return false
  const d = item.descendants ?? 0
  return d >= min && d <= max
}

type DeepPick = {
  id: number
  title: string
  descendants: number
  comments: Comment[]
  tombstoneId: number
  author: string
  firstCommentAuthor: string
}

async function tryDeepCandidate(id: number): Promise<DeepPick | null> {
  log(`discovery: checking deep candidate ${id}...`)
  const response = await getItem(id)
  const tombstoneId = firstTombstone(response.comments)
  if (tombstoneId === null) {
    log(`  ${id}: no tombstoned comment, skipping`)
    return null
  }
  const author = response.story.by
  if (!author) {
    log(`  ${id}: story has no author, skipping`)
    return null
  }
  const [storyHits, commentHits] = await Promise.all([
    getAuthorItems({ author, type: 'story', page: 0 }),
    getAuthorItems({ author, type: 'comment', page: 0 }),
  ])
  if (storyHits.nbHits < 1 || commentHits.nbHits < 1) {
    log(`  ${id}: author ${author} lacks a story+comment history (story=${storyHits.nbHits}, comment=${commentHits.nbHits}), skipping`)
    return null
  }
  const firstCommentAuthor = firstAuthor(response.comments)
  if (!firstCommentAuthor) {
    log(`  ${id}: no comment in the tree renders a byline, skipping`)
    return null
  }
  log(`  ${id}: qualifies (descendants=${response.story.descendants}, tombstone=${tombstoneId}, author=${author}, firstCommentAuthor=${firstCommentAuthor})`)
  return {
    id,
    title: response.story.title,
    descendants: response.story.descendants ?? 0,
    comments: response.comments,
    tombstoneId,
    author,
    firstCommentAuthor,
  }
}

let exploreCount = Math.min(150, realTopIds.length)
let itemById = await exploreTopItems(exploreCount)
let deepPick: DeepPick | null = null

for (;;) {
  const deepCandidates = [...itemById.entries()]
    .filter(([, item]) => inRange(item, DEEP_RANGE))
    .sort(([, a], [, b]) => (a.descendants ?? 0) - (b.descendants ?? 0))
    .map(([id]) => id)

  for (const id of deepCandidates) {
    const pick = await tryDeepCandidate(id)
    if (pick) {
      deepPick = pick
      break
    }
  }
  if (deepPick || exploreCount >= realTopIds.length) break
  exploreCount = Math.min(exploreCount * 2, realTopIds.length)
  log(`discovery: widening the deep search to the first ${exploreCount} top ids...`)
  itemById = await exploreTopItems(exploreCount)
}

if (!deepPick) {
  throw new Error(
    `record-hn-fixtures: found no qualifying "deep" thread (${DEEP_RANGE[0]}-${DEEP_RANGE[1]} descendants, a tombstone, and an author with story+comment history) among the first ${exploreCount} real top ids`,
  )
}
const deep = deepPick

let shallowId = [...itemById.entries()]
  .filter(([id, item]) => id !== deep.id && inRange(item, SHALLOW_RANGE))
  .map(([id]) => id)[0]

if (shallowId === undefined && exploreCount < realTopIds.length) {
  log('discovery: no shallow candidate yet, widening the search...')
  itemById = await exploreTopItems(realTopIds.length)
  shallowId = [...itemById.entries()]
    .filter(([id, item]) => id !== deep.id && inRange(item, SHALLOW_RANGE))
    .map(([id]) => id)[0]
}
if (shallowId === undefined) {
  throw new Error(`record-hn-fixtures: found no "shallow" candidate (${SHALLOW_RANGE[0]}-${SHALLOW_RANGE[1]} descendants) in the real top list`)
}

log(`discovery: deep=${deep.id} ("${deep.title}"), shallow=${shallowId}`)

async function findWorkingSearchQuery(title: string): Promise<string> {
  const words = title.split(/\s+/).filter(Boolean)
  const candidates = [title, words.slice(0, 6).join(' '), words.slice(0, 3).join(' ')].filter(
    (q, i, arr) => q.length > 0 && arr.indexOf(q) === i,
  )
  for (const query of candidates) {
    const result = await search({ query, page: 0 })
    if (result.nbHits >= 1) return query
  }
  throw new Error(`record-hn-fixtures: no candidate query derived from deep's title returned any hits`)
}

async function findEmptySearchQuery(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `zzz-no-hits-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const result = await search({ query: candidate, page: 0 })
    if (result.nbHits === 0) return candidate
  }
  throw new Error('record-hn-fixtures: could not find a query guaranteed to return zero hits')
}

log('discovery: verifying search queries...')
const searchQuery = await findWorkingSearchQuery(deep.title)
const emptySearchQuery = await findEmptySearchQuery()
log(`discovery: search.query=${JSON.stringify(searchQuery)}, search.emptyQuery=${JSON.stringify(emptySearchQuery)}`)

// Build the recorded `top` list: deep first, then real ids (in live order)
// whose descendants are known to be fewer than deep's, until page 1 (30) is
// full, then whatever real ids are left for page 2 — see the module doc.
const deepDescendants = deep.descendants
const usedTopIds = new Set<number>([deep.id, shallowId])
const topPage1: number[] = [deep.id, shallowId]

for (const id of realTopIds) {
  if (topPage1.length >= PAGE_SIZE) break
  if (usedTopIds.has(id)) continue
  const item = itemById.get(id)
  if (!item || (item.descendants ?? 0) >= deepDescendants) continue
  topPage1.push(id)
  usedTopIds.add(id)
}
// Fallback if descendant data ran short of filling page 1 (should not
// normally trigger: most real top ids have far fewer comments than deep).
for (const id of realTopIds) {
  if (topPage1.length >= PAGE_SIZE) break
  if (usedTopIds.has(id)) continue
  topPage1.push(id)
  usedTopIds.add(id)
}

const topPage2: number[] = []
for (const id of realTopIds) {
  if (topPage2.length >= PAGE_SIZE) break
  if (usedTopIds.has(id)) continue
  topPage2.push(id)
  usedTopIds.add(id)
}

const finalTopList = [...topPage1, ...topPage2]
if (finalTopList.length !== TOP_FEED_COUNT) {
  throw new Error(`record-hn-fixtures: built a top list of ${finalTopList.length} ids, expected ${TOP_FEED_COUNT}`)
}

// ---------------------------------------------------------------------------
// Phase 2: recording (setTransport active from here on)
// ---------------------------------------------------------------------------

const firebaseFixtures: Record<string, unknown> = {}
const algoliaFixtures: Record<string, unknown> = {}

async function fetchLive(url: string, headers: Record<string, string> | undefined) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok && response.status !== 404) {
        throw new Error(`upstream ${response.status} for ${url}`)
      }
      const body: unknown = response.status === 404 ? null : await response.json()
      return { status: response.status, body, etag: response.headers.get('etag') }
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw new Error(`record-hn-fixtures: giving up on ${url}: ${String(lastError)}`)
}

setTransport(async (url, headers) => {
  const result = await fetchLive(url, headers)
  const map = isFirebaseUrl(url) ? firebaseFixtures : algoliaFixtures
  map[fixtureKey(url)] = result.body
  return result
})

log('recording: users and author histories...')
await getUser(deep.author)
await getUser(deep.firstCommentAuthor)
await getAuthorItems({ author: deep.author, type: 'all', page: 0 })
await getAuthorItems({ author: deep.author, type: 'story', page: 0 })
await getAuthorItems({ author: deep.author, type: 'comment', page: 0 })
await getAuthorItems({ author: deep.firstCommentAuthor, type: 'all', page: 0 })

log('recording: search...')
await search({ query: searchQuery, page: 0 })
await search({ query: emptySearchQuery, page: 0 })

log(`recording: deep thread ${deep.id} (full tree)...`)
await getItem(deep.id)
log(`recording: shallow thread ${shallowId} (full tree)...`)
await getItem(shallowId)

log('recording: new/best/ask/show/job feeds...')
const feedCounts: Record<string, number> = {}
for (const feed of ['new', 'best', 'ask', 'show', 'job'] as const) {
  await getFeed(feed, 1)
  const key = `/v0/${FEED_ENDPOINTS[feed]}.json`
  const fullList = firebaseFixtures[key]
  if (!Array.isArray(fullList)) throw new Error(`record-hn-fixtures: expected an id list at ${key}`)
  const truncated = fullList.slice(0, PAGE_SIZE)
  firebaseFixtures[key] = truncated
  feedCounts[feed] = truncated.length
}

log(`recording: top feed items (${finalTopList.length} ids, deep+shallow already covered)...`)
for (const id of finalTopList) {
  if (id === deep.id || id === shallowId) continue
  await firebase.getItem(id)
}
firebaseFixtures['/v0/topstories.json'] = finalTopList
feedCounts.top = finalTopList.length

setTransport(undefined)

// ---------------------------------------------------------------------------
// Write the fixtures
// ---------------------------------------------------------------------------

const manifest = {
  recordedAt: new Date().toISOString(),
  feeds: feedCounts,
  threads: { deep: deep.id, shallow: shallowId },
  tombstoneId: deep.tombstoneId,
  user: deep.author,
  search: { query: searchQuery, emptyQuery: emptySearchQuery },
}

const outDir = fileURLToPath(new URL('../e2e/fixtures/hn/', import.meta.url))
writeFileSync(`${outDir}firebase.json`, JSON.stringify(firebaseFixtures))
writeFileSync(`${outDir}algolia.json`, JSON.stringify(algoliaFixtures))
writeFileSync(`${outDir}manifest.json`, JSON.stringify(manifest, null, 2) + '\n')

log(`wrote ${outDir}firebase.json, algolia.json, manifest.json`)
log(`manifest: ${JSON.stringify(manifest, null, 2)}`)
