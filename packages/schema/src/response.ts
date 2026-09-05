import { z } from 'zod'
import { CommentSchema, StorySchema, UserSchema } from './item.ts'

/**
 * Which path produced the comment tree. Returned so a client — and a bug
 * report — can tell a hybrid merge from a Firebase fallback without guessing,
 * and so the ordering decision recorded in `.claude/rules/hn-data.md` stays
 * observable in production rather than only in the code.
 */
export const CommentSourceSchema = z.enum(['hybrid', 'firebase'])
export type CommentSourceName = z.infer<typeof CommentSourceSchema>

export const ItemResponseSchema = z.looseObject({
  story: StorySchema,
  /** Top level, in HN's ranked order; replies nested in `children`. */
  comments: z.array(CommentSchema),
  source: CommentSourceSchema,
  /**
   * True when a node cap stopped the walk, so the tree on screen is a prefix
   * of the real one. A client that hides this is lying about the thread.
   */
  truncated: z.boolean(),
})

export type ItemResponse = z.output<typeof ItemResponseSchema>

export const UserResponseSchema = z.looseObject({ user: UserSchema })
export type UserResponse = z.output<typeof UserResponseSchema>

export const SearchSortSchema = z.enum(['relevance', 'date'])
export type SearchSort = z.infer<typeof SearchSortSchema>

export const SearchResponseSchema = z.looseObject({
  query: z.string(),
  sort: SearchSortSchema,
  /** 0-based, as Algolia counts. */
  page: z.number().int(),
  nbPages: z.number().int(),
  nbHits: z.number().int(),
  stories: z.array(StorySchema),
})

export type SearchResponse = z.output<typeof SearchResponseSchema>

/** The body behind every non-2xx. `error` is human-readable, not a code. */
export const ErrorResponseSchema = z.looseObject({ error: z.string() })
export type ErrorResponse = z.output<typeof ErrorResponseSchema>
