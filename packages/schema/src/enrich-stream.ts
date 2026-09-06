import { z } from 'zod'
import { EnrichmentsSchema, EnrichmentInputSchema } from './enrichment.ts'

/**
 * The server-sent-event contract for `GET /api/v1/enrich/thread/:id`.
 *
 * It lives in the schema package rather than in either app because it is the
 * one place the streaming producer and the streaming consumer can drift, and
 * a drift there is invisible until a summary silently stops rendering.
 *
 * The event *names* are the SSE `event:` field and the payloads are the
 * `data:` field, so a consumer switches on the name and parses with the
 * matching schema. Deltas are plain text and the terminal event carries the
 * whole thing, which means a client that misses a delta still ends up correct.
 */

/**
 * Sent first, always, before any model work begins.
 *
 * Two jobs. It tells the client whether it is about to watch a summary being
 * written or receive a stored one — different UI. And it puts a byte on the
 * wire immediately, which matters because CloudFront gives the origin 60
 * seconds to produce the first byte and a cold Lambda plus a comment-tree
 * fetch plus a model's first token is not reliably inside that.
 */
export const EnrichMetaSchema = z.looseObject({
  itemId: z.number().int(),
  /** True when the whole summary arrives in `complete` with no deltas. */
  cached: z.boolean(),
  inputKey: z.string(),
  input: EnrichmentInputSchema,
})
export type EnrichMeta = z.output<typeof EnrichMetaSchema>

/** One incremental chunk of markdown. Absent entirely on a cache hit. */
export const EnrichDeltaSchema = z.looseObject({ text: z.string() })
export type EnrichDelta = z.output<typeof EnrichDeltaSchema>

/**
 * The terminal success event. Its payload is the `enrichments` slot itself —
 * the same shape `Story.enrichments` declares — so a client merges it into the
 * story it already holds rather than learning a second shape.
 */
export const EnrichCompleteSchema = z.looseObject({ enrichments: EnrichmentsSchema })
export type EnrichComplete = z.output<typeof EnrichCompleteSchema>

/**
 * The terminal failure event. A stream that has already sent a 200 cannot
 * change its status code, so failure has to be in-band — which is also why a
 * client must treat "the stream ended without `complete`" as an error rather
 * than as a short summary.
 */
export const EnrichErrorSchema = z.looseObject({ error: z.string() })
export type EnrichError = z.output<typeof EnrichErrorSchema>

/**
 * The event names, as they appear on the wire. Persisted nowhere, but a
 * deployed client parses against them, so renaming one is a breaking change.
 */
export const ENRICH_EVENT = {
  meta: 'meta',
  delta: 'delta',
  complete: 'complete',
  error: 'error',
} as const

export type EnrichEventName = (typeof ENRICH_EVENT)[keyof typeof ENRICH_EVENT]
