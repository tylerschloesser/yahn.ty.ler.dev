import { PAGE_SIZE } from '@yahn/schema'
import type { SearchResponse, SearchSort } from '@yahn/schema'
import * as algolia from './algolia/client.ts'
import { storyFromAlgoliaHit } from './normalize.ts'

export type SearchParams = {
  query: string
  page?: number
  sort?: SearchSort
}

/**
 * Story-only search: `tags: 'story'` excludes comment hits, which have no
 * `Story`-shaped fields to normalize into. `page` is Algolia's own 0-based
 * convention (see `SearchResponseSchema.page`), passed straight through.
 *
 * Algolia caps any single query at 1,000 hits total (docs/hn-api.md) —
 * paging past that returns an error rather than an empty page, so a client
 * that wants deeper results has to slice by `created_at_i` instead.
 */
export async function search(params: SearchParams): Promise<SearchResponse> {
  const sort = params.sort ?? 'relevance'
  const result = await algolia.search({
    query: params.query,
    tags: 'story',
    page: params.page,
    sort,
    // Algolia's own default is 20 (docs/hn-api.md). A page is 30 rows
    // everywhere else in this app, and `nbPages` is computed by Algolia from
    // whatever this says — so leaving it unset would make search the one
    // surface that paginates differently from the rest.
    hitsPerPage: PAGE_SIZE,
  })

  return {
    query: params.query,
    sort,
    page: result.page,
    nbPages: result.nbPages,
    nbHits: result.nbHits,
    stories: result.hits.map(storyFromAlgoliaHit),
  }
}
