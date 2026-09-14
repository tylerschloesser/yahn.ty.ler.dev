import type { AuthorItemsResponse, AuthorItemType } from '../../shared/schema/index.js'
import { PAGE_SIZE } from '../../shared/schema/index.js'
import * as algolia from './algolia/client.js'
import { authorItemFromAlgoliaHit } from './normalize.js'

export type AuthorItemsParams = {
  author: string
  type?: AuthorItemType
  page?: number
}

/**
 * `hitsPerPage: PAGE_SIZE` so an author page is the same 30 rows as a feed
 * page, even though the two are paginated by unrelated upstreams.
 */
export async function getAuthorItems(params: AuthorItemsParams): Promise<AuthorItemsResponse> {
  const type = params.type ?? 'all'

  const result = await algolia.getAuthorItems({
    author: params.author,
    type,
    page: params.page,
    hitsPerPage: PAGE_SIZE,
  })

  return {
    author: params.author,
    type,
    page: result.page,
    nbPages: result.nbPages,
    nbHits: result.nbHits,
    items: result.hits.map(authorItemFromAlgoliaHit),
  }
}
