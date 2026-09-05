import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AuthorItemTypeSchema } from '@yahn/schema'
import { z } from 'zod'
import { AuthorHistory } from '../components/AuthorHistory/AuthorHistory.tsx'
import { UserProfile } from '../components/UserProfile/UserProfile.tsx'
import { authorItemsQueryOptions, userQueryOptions } from '../queries.ts'
import styles from './user.$id.module.css'

/**
 * `$id` is a **username**, not a number — HN user ids are strings, unlike item
 * ids, so there is no `params.parse` here.
 *
 * `p` is 1-based like every other `?p=` in this app and is converted to
 * Algolia's 0-based page in `src/api.ts`. Nothing uses `.default()` — see
 * `src/feeds.ts`.
 */
const searchSchema = z.object({
  type: AuthorItemTypeSchema.catch('all').optional(),
  p: z.coerce.number().int().positive().catch(1).optional(),
})

export const Route = createFileRoute('/user/$id')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ type: search.type ?? 'all', page: search.p ?? 1 }),
  // The profile and the history are two upstreams — Firebase for karma and
  // account age, Algolia for the submissions — so they are fetched together
  // rather than waterfalled through two suspense boundaries.
  loader: ({ context, params, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(userQueryOptions(params.id)),
      context.queryClient.ensureQueryData(
        authorItemsQueryOptions(params.id, deps.type, deps.page),
      ),
    ]),
  component: UserPage,
})

function UserPage() {
  const { id } = Route.useParams()
  const { type, page } = Route.useLoaderDeps()
  const { data: user } = useSuspenseQuery(userQueryOptions(id))
  const { data: history } = useSuspenseQuery(authorItemsQueryOptions(id, type, page))

  return (
    <div className={styles.page}>
      <UserProfile user={user} />
      <AuthorHistory id={id} type={type} page={page} nbPages={history.nbPages} items={history.items} />
    </div>
  )
}
