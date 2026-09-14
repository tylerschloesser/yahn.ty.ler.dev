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
 * The upstream knobs (`HN_SOURCE`, `COMMENT_SOURCE`, `HN_TREE_NODE_CAP`, etc.)
 * live in `server/hn`'s own `env`, not here — that package owns the
 * variables it acts on.
 */
export const env = {
  /** Port for the local dev server (`server/dev.ts`). The Vercel function never reads it. */
  get port(): number {
    return positiveInt('PORT', 3001)
  },
}

/**
 * Local-only defaults, called from `server/dev.ts` and from nowhere else.
 *
 * Nothing needs a local default in this epoch — both HN APIs are public and
 * this file carries no credentialed switches. Kept as a function (rather than
 * removed) so `server/dev.ts` has one stable seam to call, matching the shape
 * this repo will still want once a future epoch adds one.
 */
export function applyLocalDefaults(): void {}
