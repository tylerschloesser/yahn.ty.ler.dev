import { z } from 'zod'

export type AlgoliaNode = {
  id: number
  created_at: string
  created_at_i: number
  type: string
  author: string | null
  title: string | null
  url: string | null
  text: string | null
  points: number | null
  parent_id: number | null
  story_id: number | null
  options: unknown[]
  children: AlgoliaNode[]
}

/**
 * Recursive, so the type is declared above and the schema annotated with it —
 * zod cannot infer through the `get children()` cycle on its own.
 *
 * `z.looseObject(...)` rather than `z.object(...).loose()`: `.loose()` reads
 * `shape` eagerly, which fires the getter from inside this very initializer
 * and throws a TDZ error at import time. The two are otherwise the same.
 *
 * The shape is uniform between the root and every descendant: `docs/hn-api.md`
 * records that a field only relevant to one item type comes back `null`
 * rather than absent (e.g. `title`/`url` are `null` on a comment node,
 * `parent_id`/`text` are `null` on the root story node).
 */
export const AlgoliaNodeSchema: z.ZodType<AlgoliaNode> = z.looseObject({
  id: z.number().int(),
  created_at: z.string(),
  created_at_i: z.number().int(),
  type: z.string(),
  // Nullable defensively: `docs/hn-api.md` explicitly does not cover how
  // Algolia represents a deleted or dead comment, and a tree that contains one
  // must not fail to parse. Same for `story_id`.
  author: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  text: z.string().nullable(),
  points: z.number().int().nullable(),
  parent_id: z.number().int().nullable(),
  story_id: z.number().int().nullable(),
  options: z.array(z.unknown()),
  get children() {
    return z.array(AlgoliaNodeSchema)
  },
}) as z.ZodType<AlgoliaNode>

/**
 * A story hit from `/search` or `/search_by_date`. `objectID` is a **string**.
 *
 * Almost everything is `.nullish()`, and that is not defensive padding — it is
 * measured. `docs/hn-api.md`'s field table came from a `?tags=front_page`
 * probe, where `story_text` is `null` on a link story. On `?query=…&tags=story`
 * the same field is **absent** instead, and a schema that only tolerated
 * `null` turned every search into a 500. Algolia is not consistent about
 * null-versus-omitted across endpoints, so treat both as "no value" for every
 * field except the four that identify the hit.
 */
export const AlgoliaStoryHitSchema = z.looseObject({
  objectID: z.string(),
  title: z.string(),
  created_at_i: z.number().int(),
  _tags: z.array(z.string()).default([]),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().int().nullish(),
  story_text: z.string().nullish(),
  num_comments: z.number().int().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  children: z.array(z.number().int()).nullish(),
  story_id: z.number().int().nullish(),
})

export type AlgoliaStoryHit = z.output<typeof AlgoliaStoryHitSchema>

export const AlgoliaSearchResponseSchema = z.looseObject({
  hits: z.array(AlgoliaStoryHitSchema),
  page: z.number().int(),
  nbHits: z.number().int(),
  nbPages: z.number().int(),
  hitsPerPage: z.number().int(),
  processingTimeMS: z.number().int(),
  query: z.string(),
  params: z.string(),
})

export type AlgoliaSearchResponse = z.output<typeof AlgoliaSearchResponseSchema>

/**
 * A hit from `tags=author_X`, where stories and comments come back
 * interleaved in one result set. Everything except `objectID` and
 * `created_at_i` is `.nullish()` — measured, not defensive: a story hit
 * omits `story_text` entirely on a link story (present only on a self post,
 * where `url` is what's absent instead), and a comment hit has no
 * `title`/`url`/`num_comments` at all. Same Algolia inconsistency
 * `AlgoliaStoryHitSchema` already tolerates, on a different tag combination.
 */
export const AlgoliaAuthorHitSchema = z.looseObject({
  objectID: z.string(),
  created_at_i: z.number().int(),
  _tags: z.array(z.string()).default([]),
  title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string().nullish(),
  points: z.number().int().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
  story_title: z.string().nullish(),
  story_url: z.string().nullish(),
  num_comments: z.number().int().nullish(),
  parent_id: z.number().int().nullish(),
  story_id: z.number().int().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  children: z.array(z.number().int()).nullish(),
})

export type AlgoliaAuthorHit = z.output<typeof AlgoliaAuthorHitSchema>

export const AlgoliaAuthorResponseSchema = z.looseObject({
  hits: z.array(AlgoliaAuthorHitSchema),
  page: z.number().int(),
  nbHits: z.number().int(),
  nbPages: z.number().int(),
  hitsPerPage: z.number().int(),
  processingTimeMS: z.number().int(),
  query: z.string(),
  params: z.string(),
})

export type AlgoliaAuthorResponse = z.output<typeof AlgoliaAuthorResponseSchema>
