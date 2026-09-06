import { env } from '../../env.ts'
import { createAnthropicModel } from './anthropic.ts'
import { createFakeModel } from './fake.ts'

/**
 * The seam every model call goes through, and the reason this repo's central
 * invariant survives an LLM epoch: **`pnpm dev`, `pnpm verify` and `pnpm e2e`
 * need no credentials.** `applyLocalDefaults()` in `../../env.ts` sets
 * `MODEL_PROVIDER ??= 'fake'`, so a real API key is required in exactly one
 * place — Lambda, where the CDK sets `MODEL_PROVIDER=anthropic` explicitly.
 *
 * Copied from thai.ler.dev's `apps/api/src/model/index.ts`, which is where
 * this shape was proven.
 */

export interface SummaryResult {
  /** The complete markdown, identical to the concatenated deltas. */
  text: string
  /** The model id that produced it — recorded on the stored row. */
  model: string
  /** Billed tokens. `null` from `fake`, which bills nothing. */
  inputTokens: number | null
  outputTokens: number | null
}

export interface Model {
  /**
   * Streams a summary of `input`, awaiting `onDelta` for each chunk.
   *
   * `onDelta` returns a promise and is awaited on purpose: the consumer writes
   * each chunk to an SSE stream, and not awaiting it would let the model
   * outrun the socket and buffer the whole summary in memory — which is the
   * one thing this endpoint exists to avoid.
   */
  summarize(input: string, onDelta: (text: string) => Promise<void>): Promise<SummaryResult>
}

let cached: Model | undefined

/**
 * Lazy, so importing this module constructs no client and reads no secret, and
 * so a test can set `MODEL_PROVIDER` first. The choice is made once per
 * process — which in Lambda means once per cold start.
 */
export function getModel(): Model {
  cached ??= env.modelProvider === 'fake' ? createFakeModel() : createAnthropicModel()
  return cached
}
