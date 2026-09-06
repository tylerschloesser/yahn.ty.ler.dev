function positiveInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid env var ${name}: ${value} (expected a positive integer)`)
  }
  return parsed
}

/**
 * Lazy getters that re-read `process.env` on each access, so a caller can set
 * a variable before anything reads it and nothing is captured at import time.
 *
 * The upstream knobs live in `@yahn/hn`'s own `env`, not here — `COMMENT_SOURCE`,
 * `HN_TREE_NODE_CAP` and friends belong to the package that acts on them.
 */
export const env = {
  /** Port for the local dev server (`src/server.ts`). Lambda never reads it. */
  get port(): number {
    return positiveInt('PORT', 3001)
  },

  /**
   * Port for the local *enrichment* server. It is a second port rather than a
   * second route because production is a second Lambda — see `server.ts`.
   * Lambda never reads it either.
   */
  get enrichPort(): number {
    return positiveInt('ENRICH_PORT', 3002)
  },
}
