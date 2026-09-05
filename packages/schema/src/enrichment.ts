import { z } from 'zod'

/**
 * The slot every item carries for LLM-derived content — summaries,
 * fact-checks, extracted reader-mode text. Empty today, and **always absent
 * from a response**: nothing produces one yet.
 *
 * It exists now so that adding the first enrichment changes no response shape
 * and no component contract. The frontend renders it null-safely from day one;
 * the API declares it; the only thing missing is a producer.
 *
 * Loose because an enrichment kind added by a newer API must not fail an
 * older client's parse.
 */
export const EnrichmentsSchema = z.looseObject({})

export type Enrichments = z.infer<typeof EnrichmentsSchema>
