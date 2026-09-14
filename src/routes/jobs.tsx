import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FeedPage } from '../components/FeedPage/FeedPage.tsx'
import { feedSearchSchema } from '../feeds.ts'
import { feedQueryOptions } from '../queries.ts'

export const Route = createFileRoute('/jobs')({
  validateSearch: feedSearchSchema,
  // `p` is optional so a bare nav link stays bare — see `src/feeds.ts`.
  loaderDeps: ({ search }) => ({ page: search.p ?? 1 }),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(feedQueryOptions('job', deps.page)),
  component: Jobs,
})

function Jobs() {
  const { page } = Route.useLoaderDeps()
  const { data } = useSuspenseQuery(feedQueryOptions('job', page))

  return (
    <FeedPage
      heading="Jobs"
      path="/jobs"
      page={data.page}
      pageCount={data.pageCount}
      stories={data.stories}
    />
  )
}
