import type { FeedName, FeedResponse } from '@yahn/schema'
import { PAGE_SIZE } from '@yahn/schema'
import { env } from './env.ts'
import { NotFoundError } from './errors.ts'
import * as firebase from './firebase/client.ts'
import type { FirebaseItem } from './firebase/types.ts'
import { storyFromFirebase } from './normalize.ts'
import { mapWithConcurrency } from './pool.ts'

export type GetFeedDeps = {
  getStoryIds?: (feed: FeedName) => Promise<number[]>
  getItem?: (id: number) => Promise<FirebaseItem>
}

/**
 * `deps` defaults to the real Firebase client and exists so tests can inject
 * a map-backed fetcher and never touch the network — the same seam as
 * `loadFirebaseTree`'s `getItem` parameter.
 *
 * `topstories` includes job posts (docs/hn-api.md) and they are kept here:
 * filtering them out would shift this feed's page boundaries away from
 * vanilla HN's, since HN's own front page interleaves them too.
 */
export async function getFeed(
  feed: FeedName,
  page: number,
  deps?: GetFeedDeps,
): Promise<FeedResponse> {
  const getStoryIds = deps?.getStoryIds ?? firebase.getStoryIds
  const getItem = deps?.getItem ?? firebase.getItem

  const ids = await getStoryIds(feed)
  const total = ids.length
  // Feed list lengths are variable (500/500/200/55/137/31 observed) — never
  // hardcode a count, compute it from the list as fetched.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  if (page < 1 || page > pageCount) {
    throw new NotFoundError(`page ${page} not found for feed ${feed} (pageCount ${pageCount})`)
  }

  const start = (page - 1) * PAGE_SIZE
  const pageIds = ids.slice(start, start + PAGE_SIZE)

  const items = await mapWithConcurrency(pageIds, env.treeConcurrency, async (id) => {
    try {
      return await getItem(id)
    } catch {
      // An item that fails to fetch is skipped, not fatal to the page.
      return undefined
    }
  })

  const stories = items
    .filter((item): item is FirebaseItem => item !== undefined)
    .map((item) => storyFromFirebase(item))

  return { feed, page, pageCount, total, stories }
}
