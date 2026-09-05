import type { Story } from '@yahn/schema'
import { StoryList } from '../StoryList/StoryList.tsx'
import { Pagination } from '../Pagination/Pagination.tsx'
import type { FeedPath } from '../../feeds.ts'
import styles from './FeedPage.module.css'

type FeedPageProps = {
  heading: string
  path: FeedPath
  page: number
  pageCount: number
  stories: Story[]
}

// The body every feed route shares — only the heading and the route path vary
// between the six routes that render it.
export function FeedPage({ heading, path, page, pageCount, stories }: FeedPageProps) {
  return (
    <div className={styles.page}>
      <h1 data-testid="feed-title" className={styles.title}>
        {heading}
      </h1>
      <StoryList stories={stories} page={page} />
      <Pagination to={path} page={page} pageCount={pageCount} />
    </div>
  )
}
