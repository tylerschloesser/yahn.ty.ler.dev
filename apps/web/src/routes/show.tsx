import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FeedPage } from '../components/FeedPage/FeedPage.tsx'
import { feedSearchSchema } from '../feeds.ts'
import { feedQueryOptions } from '../queries.ts'

export const Route = createFileRoute('/show')({
  validateSearch: feedSearchSchema,
  // `p` is optional so a bare nav link stays bare — see `src/feeds.ts`.
  loaderDeps: ({ search }) => ({ page: search.p ?? 1 }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(feedQueryOptions('show', deps.page)),
  component: Show,
})

function Show() {
  const { page } = Route.useLoaderDeps()
  const { data } = useSuspenseQuery(feedQueryOptions('show', page))

  return (
    <FeedPage
      heading="Show HN"
      path="/show"
      page={data.page}
      pageCount={data.pageCount}
      stories={data.stories}
    />
  )
}
