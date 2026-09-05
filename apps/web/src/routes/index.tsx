import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { StoryList } from '../components/StoryList/StoryList.tsx'
import { feedQueryOptions } from '../queries.ts'
import styles from './index.module.css'

const searchSchema = z.object({
  // `.catch` covers a missing/invalid page falling back to 1, `.default`
  // makes `p` optional on the input side so `<Link to="/">` needs no search.
  p: z.coerce.number().int().positive().catch(1).default(1),
})

export const Route = createFileRoute('/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ page: search.p }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(feedQueryOptions('top', deps.page)),
  component: Index,
})

function Index() {
  const { page } = Route.useLoaderDeps()
  const { data } = useSuspenseQuery(feedQueryOptions('top', page))

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Top stories</h1>
      <StoryList stories={data.stories} page={data.page} />
      <nav className={styles.pagination} aria-label="Pagination">
        {data.page > 1 ? (
          <Link to="/" search={{ p: data.page - 1 }} className={styles.pageLink}>
            ← Prev
          </Link>
        ) : (
          <span className={styles.pageLinkDisabled}>← Prev</span>
        )}
        <span className={styles.pageStatus}>
          Page {data.page} of {data.pageCount}
        </span>
        {data.page < data.pageCount ? (
          <Link to="/" search={{ p: data.page + 1 }} className={styles.pageLink}>
            Next →
          </Link>
        ) : (
          <span className={styles.pageLinkDisabled}>Next →</span>
        )}
      </nav>
    </div>
  )
}
