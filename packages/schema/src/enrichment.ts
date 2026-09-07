import { z } from 'zod'

/**
 * LLM-derived content attached to an item — summaries, fact-checks, extracted
 * reader-mode text. The slot was reserved in Epoch 1 as an always-absent
 * `enrichments` field on `Story` and `Comment` so that adding the first one
 * changed no response shape and no component contract. Epoch 4 adds the first
 * producer: `threadSummary`.
 *
 * Loose, and it must stay loose: an enrichment kind added by a newer API must
 * not fail an older deployed client's parse.
 */

/**
 * Which enrichment a stored row is. This is the `<kind>` in the DynamoDB sort
 * key `ENRICH#<kind>#<inputKey>`, so **the string values are persisted** —
 * renaming one orphans every row already written under the old name.
 */
export const EnrichmentKindSchema = z.enum(['thread-summary'])
export type EnrichmentKind = z.infer<typeof EnrichmentKindSchema>

/**
 * What was actually sent to the model, recorded on the row that came back.
 *
 * This exists because "whole tree, or a selection?" is the open question this
 * epoch has to *measure* rather than decide by taste, and a measurement you
 * cannot re-derive from stored data is one you have to re-run. Every stored
 * summary therefore carries its own input size, its own token counts and the
 * name of the strategy that produced it.
 */
export const EnrichmentInputSchema = z.looseObject({
  /**
   * Which selection produced the input. Deliberately a plain string and not a
   * `z.enum`: loose objects tolerate unknown *keys*, not unknown enum
   * *values*, so an enum here would mean that adding a strategy breaks the
   * parse in every already-deployed web build.
   */
  strategy: z.string(),

  /** Comments actually sent, and how many the thread holds. The ratio is the point. */
  comments: z.number().int(),
  totalComments: z.number().int(),

  /** Characters of prompt input. The cheap proxy for cost, available offline. */
  chars: z.number().int(),

  /**
   * The `budget` strategy's char cap at generation time, `null` for the other
   * two strategies. `store.ts`'s cheap read-through compares this against a
   * fresh request's own budget instead of re-rendering to learn how much of
   * the thread it would cover. `.optional()` so a row written before this
   * field existed still parses — it just can't satisfy that comparison and
   * falls back to a full re-render, same as today.
   */
  budgetChars: z.number().int().nullable().optional(),

  /** Billed tokens, when the provider reported them. `fake` reports none. */
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
})

export type EnrichmentInput = z.output<typeof EnrichmentInputSchema>

/**
 * A summary of a story's comment thread.
 *
 * `text` is **markdown, streamed as plain-text deltas** rather than a
 * structured object. That is a deliberate choice against structured output:
 * the epoch's headline is that a reader watches the summary arrive, and a
 * partially-received JSON object cannot be rendered without a partial-JSON
 * parser, while partially-received markdown renders as exactly itself.
 */
export const ThreadSummarySchema = z.looseObject({
  /** Markdown. */
  text: z.string(),

  /** The model id that produced it, so a row records what it cost to make. */
  model: z.string(),

  /** Unix seconds. */
  generatedAt: z.number().int(),

  /**
   * `sha256` of the exact bytes sent to the model, truncated like `contentKey`.
   *
   * **Not the story's `contentKey`**, and this is the correction Epoch 4 had
   * to make to the original plan. `contentKey` is `sha256(url ?? text)`, which
   * for a story is fixed the moment it is posted — it does not change when a
   * comment arrives. Keying a *thread* summary against it would pin the first
   * summary of an empty thread forever.
   *
   * Hashing the model input instead makes the cache key mean the only thing a
   * cache key can honestly mean here: a hit is the answer to the same
   * question. It also generalizes without a special case — an article
   * summary's input is the article, so its key reduces to the story's own
   * `contentKey` — and it keeps two selection strategies from ever serving
   * each other's answers, since a different selection is different bytes.
   */
  inputKey: z.string(),

  input: EnrichmentInputSchema,
})

export type ThreadSummary = z.output<typeof ThreadSummarySchema>

export const EnrichmentsSchema = z.looseObject({
  threadSummary: ThreadSummarySchema.optional(),
})

export type Enrichments = z.output<typeof EnrichmentsSchema>
