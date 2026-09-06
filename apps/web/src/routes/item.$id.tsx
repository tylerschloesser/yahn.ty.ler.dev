import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { CommentTree } from '../components/CommentTree/CommentTree.tsx'
import { StoryHeader } from '../components/StoryHeader/StoryHeader.tsx'
import { ThreadSummary } from '../components/ThreadSummary/ThreadSummary.tsx'
import { itemQueryOptions } from '../queries.ts'
import styles from './item.$id.module.css'

export const Route = createFileRoute('/item/$id')({
  params: {
    parse: (rawParams) => {
      const id = Number(rawParams.id)
      if (!Number.isInteger(id)) throw notFound()
      return { id }
    },
    stringify: ({ id }) => ({ id: String(id) }),
  },
  loader: ({ context, params }) => context.queryClient.ensureQueryData(itemQueryOptions(params.id)),
  component: Item,
})

function Item() {
  const { id } = Route.useParams()
  const { data } = useSuspenseQuery(itemQueryOptions(id))

  return (
    <div className={styles.page}>
      <StoryHeader story={data.story} truncated={data.truncated} />
      <ThreadSummary itemId={id} />
      <CommentTree comments={data.comments} />
    </div>
  )
}
