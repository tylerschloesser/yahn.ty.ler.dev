import { env } from '../env.ts'
import { NotFoundError, UpstreamError } from '../errors.ts'
import { fetchJson } from '../http.ts'
import {
  AlgoliaAuthorResponseSchema,
  AlgoliaNodeSchema,
  AlgoliaSearchResponseSchema,
  type AlgoliaAuthorResponse,
  type AlgoliaNode,
  type AlgoliaSearchResponse,
} from './types.ts'

// Unlike Firebase's 200+null, Algolia returns a proper 404 for a missing item.
export async function getItem(id: number): Promise<AlgoliaNode> {
  try {
    const { body } = await fetchJson<unknown>(`${env.algoliaBaseUrl}/items/${id}`)
    return AlgoliaNodeSchema.parse(body)
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) {
      throw new NotFoundError(`item ${id} not found`)
    }
    throw error
  }
}

export type AlgoliaSearchParams = {
  query: string
  tags?: string
  page?: number
  hitsPerPage?: number
  sort: 'relevance' | 'date'
}

/**
 * 10,000 requests/hour/IP, and no `X-RateLimit-*` headers — the limit is
 * discovered only by being blocked. A server behind a single egress IP
 * shares that budget across every caller, which is the argument for caching
 * search results hard rather than proxying per-user traffic straight
 * through.
 */
export async function search(params: AlgoliaSearchParams): Promise<AlgoliaSearchResponse> {
  const endpoint = params.sort === 'date' ? 'search_by_date' : 'search'
  const query = new URLSearchParams({ query: params.query })
  if (params.tags) query.set('tags', params.tags)
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.hitsPerPage !== undefined) query.set('hitsPerPage', String(params.hitsPerPage))

  const { body } = await fetchJson<unknown>(`${env.algoliaBaseUrl}/${endpoint}?${query.toString()}`)
  return AlgoliaSearchResponseSchema.parse(body)
}

export type AlgoliaAuthorParams = {
  author: string
  type?: 'all' | 'story' | 'comment'
  page?: number
  hitsPerPage?: number
}

/**
 * Always `search_by_date`: a profile is a timeline, and relevance ranking is
 * meaningless with no `query`. `tags` combines with a comma, which is AND in
 * Algolia's tag grammar (docs/hn-api.md) — `author_X,story` narrows to that
 * author's stories, not stories OR that author.
 */
export async function getAuthorItems(params: AlgoliaAuthorParams): Promise<AlgoliaAuthorResponse> {
  const tags =
    params.type === 'story' || params.type === 'comment'
      ? `author_${params.author},${params.type}`
      : `author_${params.author}`

  const query = new URLSearchParams({ tags })
  if (params.page !== undefined) query.set('page', String(params.page))
  if (params.hitsPerPage !== undefined) query.set('hitsPerPage', String(params.hitsPerPage))

  const { body } = await fetchJson<unknown>(`${env.algoliaBaseUrl}/search_by_date?${query.toString()}`)
  return AlgoliaAuthorResponseSchema.parse(body)
}
