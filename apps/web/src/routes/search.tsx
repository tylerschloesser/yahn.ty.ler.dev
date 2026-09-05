import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { SearchSortSchema } from '@yahn/schema'
import type { SearchSort } from '@yahn/schema'
import { z } from 'zod'
import { Pagination } from '../components/Pagination/Pagination.tsx'
import { StoryList } from '../components/StoryList/StoryList.tsx'
import { searchQueryOptions } from '../queries.ts'
import styles from './search.module.css'

/**
 * `q` defaults to empty rather than being required, so `/search` with nothing
 * typed is a valid page that renders the empty state instead of a router
 * error. `p` is 1-based like every other `?p=` in this app and is converted to
 * Algolia's 0-based page in `src/api.ts`.
 *
 * Nothing here uses `.default()` — see `src/feeds.ts` for why: TanStack writes
 * a default search value into the URL on any navigation that omits it.
 */
const searchSchema = z.object({
  q: z.string().catch('').optional(),
  sort: SearchSortSchema.catch('relevance').optional(),
  p: z.coerce.number().int().positive().catch(1).optional(),
})

export const Route = createFileRoute('/search')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    query: search.q ?? '',
    sort: search.sort ?? 'relevance',
    page: search.p ?? 1,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(searchQueryOptions(deps.query, deps.page, deps.sort)),
  component: SearchPage,
})

const SORTS = ['relevance', 'date'] as const satisfies readonly SearchSort[]

function SearchPage() {
  const { query, sort, page } = Route.useLoaderDeps()

  return (
    <div className={styles.page}>
      <h1 data-testid="search-heading" className={styles.heading}>
        {query ? `Search: ${query}` : 'Search'}
      </h1>
      {query ? (
        <>
          <SortLinks query={query} sort={sort} />
          <SearchResults query={query} page={page} sort={sort} />
        </>
      ) : (
        <p data-testid="search-empty" className={styles.empty}>
          Type something in the search box to find stories.
        </p>
      )}
    </div>
  )
}

type SortLinksProps = {
  query: string
  sort: SearchSort
}

// Resets to page 1 on every sort change — a different sort is a different
// result set, not a page within the current one.
function SortLinks({ query, sort }: SortLinksProps) {
  return (
    <nav aria-label="Sort results" className={styles.sorts}>
      {SORTS.map((option) => (
        <Link
          key={option}
          to="/search"
          search={{ q: query, sort: option, p: 1 }}
          className={styles.sortLink}
          {...(sort === option ? { 'data-active': '' } : {})}
        >
          {option === 'relevance' ? 'Relevance' : 'Date'}
        </Link>
      ))}
    </nav>
  )
}

type SearchResultsProps = {
  query: string
  page: number
  sort: SearchSort
}

// Split out from `SearchPage` so the empty-query case never reaches
// `useSuspenseQuery` — `searchQueryOptions` sets `enabled: false` for it, and
// suspense has nothing to resolve to in that case.
function SearchResults({ query, page, sort }: SearchResultsProps) {
  const { data } = useSuspenseQuery(searchQueryOptions(query, page, sort))

  if (data.nbHits === 0) {
    return (
      <p data-testid="search-empty" className={styles.empty}>
        No stories matched &ldquo;{query}&rdquo;.
      </p>
    )
  }

  return (
    <>
      <StoryList stories={data.stories} page={page} />
      {/* nbPages, never nbHits / PAGE_SIZE — Algolia clamps nbPages to its
          1,000-hit ceiling, so a broad query would otherwise link to pages
          that error. See docs/hn-api.md. */}
      <Pagination target={{ kind: 'search', query, sort }} page={page} pageCount={data.nbPages} />
    </>
  )
}
