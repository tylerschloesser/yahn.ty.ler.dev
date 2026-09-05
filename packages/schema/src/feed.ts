import { z } from 'zod'
import { StorySchema } from './item.ts'

/**
 * The six ranked lists HN publishes. `top` and `new` are capped at 500; the
 * rest are shorter and variable (200/55/137/31 observed for best/ask/show/job
 * on 2026-09-05). Nothing here or downstream may hardcode a count — page
 * counts come from the list length as fetched. See `docs/hn-api.md`.
 */
export const FeedNameSchema = z.enum(['top', 'new', 'best', 'ask', 'show', 'job'])
export type FeedName = z.infer<typeof FeedNameSchema>

/** HN's own page size, and the unit `page` counts in. */
export const PAGE_SIZE = 30

export const FeedResponseSchema = z.looseObject({
  feed: FeedNameSchema,
  /** 1-based, matching HN's `?p=`. */
  page: z.number().int(),
  /** Ceil(list length / PAGE_SIZE) for the list as fetched this request. */
  pageCount: z.number().int(),
  /** Total ids in the underlying list, before paging. */
  total: z.number().int(),
  stories: z.array(StorySchema),
})

export type FeedResponse = z.output<typeof FeedResponseSchema>
