import { z } from 'zod'
import { EnrichmentsSchema, type Enrichments } from './enrichment.ts'

/**
 * The shapes this API returns, not the shapes Hacker News returns.
 * `packages/hn` normalizes: a field HN omits comes back as `null` rather than
 * missing, so a consumer never has to distinguish "absent" from "empty".
 *
 * Every object is `z.looseObject`. The HN API README is explicit that clients
 * must tolerate new fields, and the same courtesy runs one layer further out:
 * a deployed web build must keep parsing responses from an API that has since
 * grown a field. Unknown keys pass through instead of failing the parse.
 */

/** What a story-shaped item actually is. `poll` renders as a story today. */
export const StoryKindSchema = z.enum(['story', 'job', 'poll'])
export type StoryKind = z.infer<typeof StoryKindSchema>

const ItemBase = {
  id: z.number().int(),

  /** Author. `null` on a deleted item, whose author HN withholds. */
  by: z.string().nullable(),

  /** Unix seconds. */
  time: z.number().int(),

  /**
   * `sha256(url ?? text ?? '').slice(0, 16)` — the key an enrichment is cached
   * against. A summary stays valid exactly as long as the content it
   * summarized is unchanged. Cheap to compute now and impossible to backfill
   * consistently later, which is why it is here before anything reads it.
   */
  contentKey: z.string(),

  /** HN's two tombstone flags. Both are `false` on a normal item. */
  deleted: z.boolean(),
  dead: z.boolean(),

  /** Reserved. Always absent today. See `EnrichmentsSchema`. */
  enrichments: EnrichmentsSchema.optional(),
}

export const StorySchema = z.looseObject({
  ...ItemBase,
  kind: StoryKindSchema,
  title: z.string(),

  /** External link, or `null` for a self post (Ask HN, most polls). */
  url: z.string().nullable(),

  /**
   * Display host for `url`, `www.` stripped — `null` when there is no url.
   * Derived here rather than in the client so every surface agrees.
   */
  host: z.string().nullable(),

  /** Self-post body, HN-flavored HTML. `null` when the story is a link. */
  text: z.string().nullable(),

  /** Live values from Firebase. `null` where HN does not publish one. */
  score: z.number().int().nullable(),
  descendants: z.number().int().nullable(),
})

export type Story = z.output<typeof StorySchema>

export type Comment = {
  id: number
  by: string | null
  time: number
  contentKey: string
  deleted: boolean
  dead: boolean
  enrichments?: Enrichments
  /** HN-flavored HTML. `null` on a tombstone. */
  text: string | null
  /** The item this hangs off — a story id at the top level. */
  parent: number | null
  /** In HN's ranked display order. Empty on a leaf. */
  children: Comment[]
}

/**
 * Recursive, so the type is declared above and the schema annotated with it —
 * zod cannot infer through the `get children()` cycle on its own.
 *
 * `z.looseObject(...)` rather than `z.object(...).loose()`: `.loose()` reads
 * `shape` eagerly, which fires the getter from inside this very initializer
 * and throws a TDZ error at import time. The two are otherwise the same.
 */
export const CommentSchema: z.ZodType<Comment> = z.looseObject({
  ...ItemBase,
  text: z.string().nullable(),
  parent: z.number().int().nullable(),
  get children() {
    return z.array(CommentSchema)
  },
}) as z.ZodType<Comment>

export const UserSchema = z.looseObject({
  id: z.string(),
  /** Unix seconds. */
  created: z.number().int(),
  karma: z.number().int(),
  /** Profile text, HN-flavored HTML. */
  about: z.string().nullable(),
})

export type User = z.output<typeof UserSchema>
