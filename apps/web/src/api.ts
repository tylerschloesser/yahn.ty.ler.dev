import { ErrorResponseSchema, FeedResponseSchema, ItemResponseSchema } from '@yahn/schema'
import type { FeedName, FeedResponse, ItemResponse } from '@yahn/schema'

/**
 * Thin typed fetchers over `fetch`. Always same-origin, relative paths —
 * never a base URL — because the dev proxy and (eventually) CloudFront both
 * make `/api/*` same-origin already.
 */

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path)
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const parsed = ErrorResponseSchema.safeParse(body)
    const message = parsed.success ? parsed.data.error : response.statusText
    throw new Error(`${response.status} ${message}`)
  }
  return response.json()
}

export async function fetchFeed(feed: FeedName, page: number): Promise<FeedResponse> {
  const body = await getJson(`/api/v1/feeds/${feed}?page=${page}`)
  // Parsed rather than trusted: a contract drift between this client and the
  // API fails loudly here instead of surfacing as `undefined` three
  // components deep.
  return FeedResponseSchema.parse(body)
}

export async function fetchItem(id: number): Promise<ItemResponse> {
  const body = await getJson(`/api/v1/items/${id}`)
  return ItemResponseSchema.parse(body)
}
