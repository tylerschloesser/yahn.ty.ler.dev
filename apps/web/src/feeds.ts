import { z } from 'zod'
import type { FeedName } from '@yahn/schema'

/** The six feed routes, as the router knows them. */
export type FeedPath = '/' | '/newest' | '/best' | '/ask' | '/show' | '/jobs'

type Section = {
  path: FeedPath
  /** The header nav's label — HN's own wording, lowercase. */
  label: string
  feed: FeedName
  heading: string
}

/**
 * One table, in HN's nav order, so the header, the page headings and the
 * route-to-feed mapping cannot drift apart. Note `/jobs` serves the feed named
 * `job`, singular — that mismatch is HN's, not a typo.
 */
export const SECTIONS = [
  { path: '/', label: 'top', feed: 'top', heading: 'Top stories' },
  { path: '/newest', label: 'new', feed: 'new', heading: 'New stories' },
  { path: '/best', label: 'best', feed: 'best', heading: 'Best stories' },
  { path: '/ask', label: 'ask', feed: 'ask', heading: 'Ask HN' },
  { path: '/show', label: 'show', feed: 'show', heading: 'Show HN' },
  { path: '/jobs', label: 'jobs', feed: 'job', heading: 'Jobs' },
] as const satisfies readonly Section[]

/**
 * Shared by all six feed routes.
 *
 * **No `.default(1)`**, deliberately. TanStack Router writes a default search
 * value into the URL on any client-side navigation that omits `search`, so a
 * bare `<Link to="/newest">` in the header would land on `/newest?p=1`. Making
 * `p` optional and resolving the fallback in `loaderDeps` keeps the bare path
 * bare while still letting `Pagination` link explicitly back to `?p=1`.
 * `stripSearchParams` is the obvious alternative and does not work here: it
 * removes the explicit `?p=1` too.
 *
 * `.catch(1)` still covers a `p` that is present but nonsense.
 */
export const feedSearchSchema = z.object({
  p: z.coerce.number().int().positive().catch(1).optional(),
})
