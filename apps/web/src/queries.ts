import { queryOptions } from '@tanstack/react-query'
import type { FeedName } from '@yahn/schema'
import { fetchFeed, fetchItem } from './api.ts'

export function feedQueryOptions(feed: FeedName, page: number) {
  return queryOptions({
    queryKey: ['feed', feed, page] as const,
    queryFn: () => fetchFeed(feed, page),
  })
}

export function itemQueryOptions(id: number) {
  return queryOptions({
    queryKey: ['item', id] as const,
    queryFn: () => fetchItem(id),
  })
}
