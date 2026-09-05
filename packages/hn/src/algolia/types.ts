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

/** A story hit from `/search` or `/search_by_date`. `objectID` is a string. */
export const AlgoliaStoryHitSchema = z.looseObject({
  objectID: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  points: z.number().int().nullable(),
  story_text: z.string().nullable(),
  num_comments: z.number().int().nullable(),
  created_at: z.string(),
  created_at_i: z.number().int(),
  updated_at: z.string(),
  children: z.array(z.number().int()),
  story_id: z.number().int().nullable(),
  _tags: z.array(z.string()),
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
