function choice<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const value = process.env[name]
  if (!value) return fallback
  if ((values as readonly string[]).includes(value)) return value as T
  throw new Error(`invalid env var ${name}: ${value} (expected one of ${values.join(', ')})`)
}

function positiveInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid env var ${name}: ${value} (expected a positive integer)`)
  }
  return parsed
}

export const env = {
  /**
   * Which path builds a comment tree. 'firebase' walks Firebase directly —
   * one request per node, but `kids` is HN's ranked display order. 'hybrid'
   * takes Algolia's whole nested tree in one request and merges Firebase's
   * live score/descendants over it.
   *
   * **The default is 'firebase' because the ordering spike found Algolia's
   * `children` to be strictly ascending by id at every depth** — chronological,
   * not ranked. `.claude/rules/hn-data.md` has the measurement and
   * `scripts/ordering-spike.mjs` re-runs it. 'hybrid' stays reachable, and
   * stays the right fallback when Algolia is the only thing answering, but it
   * buys one round trip at the price of wrong sibling order everywhere.
   */
  get commentSource(): 'hybrid' | 'firebase' {
    return choice('COMMENT_SOURCE', ['hybrid', 'firebase'], 'firebase')
  },

  get firebaseBaseUrl(): string {
    return process.env['HN_FIREBASE_URL'] || 'https://hacker-news.firebaseio.com/v0'
  },

  get algoliaBaseUrl(): string {
    return process.env['HN_ALGOLIA_URL'] || 'https://hn.algolia.com/api/v1'
  },

  get httpTimeoutMs(): number {
    return positiveInt('HN_HTTP_TIMEOUT_MS', 5000)
  },

  get treeConcurrency(): number {
    return positiveInt('HN_TREE_CONCURRENCY', 24)
  },

  /**
   * Caps the number of comment nodes a tree walk will visit. The largest
   * front-page thread measured in `docs/hn-api.md` (2026-09-05) had 1,460
   * comments, so this caps above the realistic worst case rather than below
   * it — a normal thread should never hit the cap.
   */
  get treeNodeCap(): number {
    return positiveInt('HN_TREE_NODE_CAP', 2000)
  },
}
