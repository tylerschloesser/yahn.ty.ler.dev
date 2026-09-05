import { queryOptions } from '@tanstack/react-query'
import type { AuthorItemType, FeedName, SearchSort } from '@yahn/schema'
import { fetchAuthorItems, fetchFeed, fetchItem, fetchSearch, fetchUser } from './api.ts'

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

export function searchQueryOptions(query: string, page: number, sort: SearchSort) {
  return queryOptions({
    queryKey: ['search', query, page, sort] as const,
    queryFn: () => fetchSearch(query, page, sort),
    // A search is only worth running when there is something to search for.
    // The route still renders — it shows the empty state instead.
    enabled: query.length > 0,
  })
}

export function userQueryOptions(id: string) {
  return queryOptions({
    queryKey: ['user', id] as const,
    queryFn: () => fetchUser(id),
  })
}

export function authorItemsQueryOptions(id: string, type: AuthorItemType, page: number) {
  return queryOptions({
    queryKey: ['author-items', id, type, page] as const,
    queryFn: () => fetchAuthorItems(id, type, page),
  })
}
