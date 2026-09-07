import { apiFetch } from '@tylerschloesser/cdk-core/auth/browser'
import {
  AuthorItemsResponseSchema,
  ErrorResponseSchema,
  FeedResponseSchema,
  ItemResponseSchema,
  MeResponseSchema,
  SearchResponseSchema,
  UserResponseSchema,
} from '@yahn/schema'
import type {
  AuthorItemType,
  AuthorItemsResponse,
  FeedName,
  FeedResponse,
  ItemResponse,
  MeResponse,
  SearchResponse,
  SearchSort,
  User,
} from '@yahn/schema'

/**
 * Thin typed fetchers over `apiFetch`. Always same-origin, relative paths —
 * never a base URL — because the dev proxy and (eventually) CloudFront both
 * make `/api/*` same-origin already. `apiFetch` (not `fetch`) is the point:
 * it is where the `x-id-token` header gets attached, so no component or
 * fetcher here ever has to know a token exists.
 */

async function getJson(path: string): Promise<unknown> {
  const response = await apiFetch(path)
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

export async function fetchSearch(
  query: string,
  page: number,
  sort: SearchSort,
): Promise<SearchResponse> {
  // Algolia counts pages from 0 and the API passes that straight through, but
  // every `?p=` in this app is 1-based because HN's is. The conversion lives
  // here, at the one boundary between the two conventions, rather than in
  // three components that each have to remember it.
  const params = new URLSearchParams({ q: query, page: String(page - 1), sort })
  const body = await getJson(`/api/v1/search?${params.toString()}`)
  return SearchResponseSchema.parse(body)
}

export async function fetchUser(id: string): Promise<User> {
  const body = await getJson(`/api/v1/users/${encodeURIComponent(id)}`)
  return UserResponseSchema.parse(body).user
}

export async function fetchAuthorItems(
  id: string,
  type: AuthorItemType,
  page: number,
): Promise<AuthorItemsResponse> {
  // 1-based in, 0-based out — see `fetchSearch`.
  const params = new URLSearchParams({ type, page: String(page - 1) })
  const body = await getJson(`/api/v1/users/${encodeURIComponent(id)}/items?${params.toString()}`)
  return AuthorItemsResponseSchema.parse(body)
}

// Can't go through `getJson`: it throws on any non-2xx, but a 401 here is
// the ordinary anonymous answer, not an error.
export async function fetchMe(): Promise<MeResponse | null> {
  const response = await apiFetch('/api/v1/me')
  if (response.status === 401) return null
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const parsed = ErrorResponseSchema.safeParse(body)
    const message = parsed.success ? parsed.data.error : response.statusText
    throw new Error(`${response.status} ${message}`)
  }
  return MeResponseSchema.parse(await response.json())
}
