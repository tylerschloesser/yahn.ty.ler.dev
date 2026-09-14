import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { UpstreamError } from '../errors.js'

/** One recorded response body, keyed by `fixtureKey(url)`. `null` is a recorded miss
 * (Firebase's 200+null), which is different from the key being absent altogether. */
export type FixtureMap = Record<string, unknown>

export type FixtureBundle = { firebase: FixtureMap; algolia: FixtureMap }

export type TransportResult = { status: number; body: unknown; etag: string | null }

/**
 * Canonicalizes a request URL to the key fixtures are recorded and looked up
 * under: pathname plus query params sorted by key, so the order a query
 * string happens to be built in at record time never has to match the order
 * at lookup time. The scheme/host is dropped on purpose — fixtures are
 * recorded against the live hosts but served under whatever
 * `HN_FIREBASE_URL`/`HN_ALGOLIA_URL` a fixture run is configured with.
 */
export function fixtureKey(url: string): string {
  const parsed = new URL(url)
  const sorted = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))
  const query = new URLSearchParams(sorted).toString()
  return query ? `${parsed.pathname}?${query}` : parsed.pathname
}

/** Firebase's default host is `hacker-news.firebaseio.com`; everything else recorded here is Algolia. */
export function isFirebaseUrl(url: string): boolean {
  return new URL(url).hostname.includes('firebaseio')
}

/**
 * Builds a transport function that resolves every request out of `fixtures`,
 * keyed by `fixtureKey`. `If-None-Match` is ignored entirely — the recorded
 * body is always served fresh, per `.claude/rules/hn-data.md` — and a
 * `null`-recorded key still resolves (a recorded miss), while a key absent
 * from the map throws `UpstreamError` naming the url, exactly like an
 * unretryable live failure (`.claude/rules/testing.md`: it surfaces as a 502,
 * meaning "missing fixture", not a bug in the walk).
 */
export function createFixtureTransport(fixtures: FixtureBundle) {
  return async function fixtureTransport(url: string): Promise<TransportResult> {
    const map = isFirebaseUrl(url) ? fixtures.firebase : fixtures.algolia
    const key = fixtureKey(url)
    if (!(key in map)) {
      throw new UpstreamError(`no recorded fixture for ${url}`)
    }
    return { status: 200, body: map[key] ?? null, etag: null }
  }
}

let cachedBundle: FixtureBundle | undefined

function loadJson(relativePath: string): FixtureMap {
  const fileUrl = new URL(relativePath, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(fileUrl), 'utf8')) as FixtureMap
}

function loadBundle(): FixtureBundle {
  cachedBundle ??= {
    firebase: loadJson('../../../e2e/fixtures/hn/firebase.json'),
    algolia: loadJson('../../../e2e/fixtures/hn/algolia.json'),
  }
  return cachedBundle
}

/**
 * The file-backed transport `server/hn/http.ts` uses when `HN_SOURCE=fixture`.
 * Lazy so importing this module reads no file, and a test never has to touch
 * `e2e/fixtures/hn/*.json` — it builds its own `FixtureBundle` and calls
 * `createFixtureTransport` directly instead.
 */
export function fixtureTransport(url: string): Promise<TransportResult> {
  return createFixtureTransport(loadBundle())(url)
}
