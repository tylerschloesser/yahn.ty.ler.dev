function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var ${name}`)
  return value
}

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

  /** The enrichment cache table. Required whenever `store` is `dynamo`. */
  get enrichTableName(): string {
    return required('ENRICH_TABLE_NAME')
  },

  /** Secrets Manager id holding the Anthropic key. Required in `anthropic` mode. */
  get anthropicSecretId(): string {
    return required('ANTHROPIC_SECRET_ID')
  },

  /**
   * The two backend switches, and the reason this repo's central invariant
   * survives an LLM epoch. Each default is Lambda's behaviour, so Lambda never
   * has to set them; `applyLocalDefaults()` flips both for everything else.
   */
  get store(): 'dynamo' | 'memory' {
    return choice('STORE', ['dynamo', 'memory'], 'dynamo')
  },

  get modelProvider(): 'anthropic' | 'fake' {
    return choice('MODEL_PROVIDER', ['anthropic', 'fake'], 'anthropic')
  },

  /**
   * Pause between chunks from the `fake` model. Small enough that the e2e
   * suite stays fast, non-zero so a Playwright spec asserting that a summary
   * arrives *incrementally* has something incremental to watch.
   */
  get fakeModelDelayMs(): number {
    const value = process.env['FAKE_MODEL_DELAY_MS']
    if (!value) return 120
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(
        `invalid env var FAKE_MODEL_DELAY_MS: ${value} (expected a non-negative number)`,
      )
    }
    return parsed
  },
}

export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'

/**
 * Local-only defaults, called from `src/server.ts` and from nowhere else —
 * **never** from `src/lambda.ts` or `src/lambda-enrich.ts`.
 *
 * This is the single function that keeps `pnpm dev`, `pnpm verify` and
 * `pnpm e2e` working with no AWS account, no credentials and no API key, which
 * is the property that lets a session verify its own work before opening a PR.
 * Losing it would not fail loudly; it would fail the first time someone without
 * credentials cloned the repo.
 *
 * `??=` means an explicit override always wins, and it is safe to call before
 * anything else touches env because every getter above is lazy.
 */
export function applyLocalDefaults(): void {
  process.env.STORE ??= 'memory'
  process.env.MODEL_PROVIDER ??= 'fake'
  // The CDK only ever emits AUTH=cognito. `local` trusts any `x-id-token`
  // starting with `dev:`, which is what keeps sign-in credential-free here.
  process.env.AUTH ??= 'local'
}
