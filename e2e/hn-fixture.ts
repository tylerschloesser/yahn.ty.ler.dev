import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The shape of `e2e/fixtures/hn/manifest.json`, written by
 * `scripts/record-hn-fixtures.ts` (C6) alongside the recorded HN payloads it
 * describes. This chunk ships only a placeholder manifest with dummy values
 * of the right shape — every spec that reads it must not depend on those
 * placeholder values being real, only on the shape.
 */
export interface HnManifest {
  /** ISO timestamp of the recording run. */
  readonly recordedAt: string
  /** Feed name -> the number of ids recorded for it (30+, so page 2 exists). */
  readonly feeds: Readonly<Record<string, number>>
  /** Two recorded thread ids: one deep with a tombstoned comment, one shallow (5–30 comments). */
  readonly threads: {
    readonly deep: number
    readonly shallow: number
  }
  /** The id of the tombstoned comment inside `threads.deep`. */
  readonly tombstoneId: number
  /** A recorded HN username with a profile and a history. */
  readonly user: string
  readonly search: {
    /** A query recorded to return at least one story row. */
    readonly query: string
    /** A query recorded to return no rows at all. */
    readonly emptyQuery: string
  }
}

const manifestUrl = new URL('./fixtures/hn/manifest.json', import.meta.url)

let cached: HnManifest | undefined

function assertShape(value: unknown): asserts value is HnManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('hn-fixture: manifest.json is not an object')
  }
  const required = ['recordedAt', 'feeds', 'threads', 'tombstoneId', 'user', 'search'] as const
  for (const key of required) {
    if (!(key in value)) {
      throw new Error(`hn-fixture: manifest.json is missing "${key}"`)
    }
  }
}

/** Reads and memoises `e2e/fixtures/hn/manifest.json`. */
export function readManifest(): HnManifest {
  if (!cached) {
    const raw = readFileSync(fileURLToPath(manifestUrl), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    assertShape(parsed)
    cached = parsed
  }
  return cached
}
