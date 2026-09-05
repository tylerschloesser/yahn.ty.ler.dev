import { z } from 'zod'
import { AuthorItemSchema, CommentSchema, StorySchema, UserSchema } from './item.ts'

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

/** Which slice of an author's history to return. */
export const AuthorItemTypeSchema = z.enum(['all', 'story', 'comment'])
export type AuthorItemType = z.infer<typeof AuthorItemTypeSchema>

/**
 * An author's history, newest first. Always date-sorted — a profile is a
 * timeline, and Algolia's relevance ranking is meaningless without a query.
 *
 * `page`/`nbPages` are Algolia's own 0-based pagination, passed through
 * exactly as `SearchResponse` does. Note that `nbHits` is the true total but
 * `nbPages` is already clamped by Algolia's 1,000-hit ceiling — a prolific
 * author reports `nbHits: 10723` alongside `nbPages: 34`, and that is not a
 * bug in this API. See `docs/hn-api.md`.
 */
export const AuthorItemsResponseSchema = z.looseObject({
  author: z.string(),
  type: AuthorItemTypeSchema,
  page: z.number().int(),
  nbPages: z.number().int(),
  nbHits: z.number().int(),
  items: z.array(AuthorItemSchema),
})

export type AuthorItemsResponse = z.output<typeof AuthorItemsResponseSchema>
