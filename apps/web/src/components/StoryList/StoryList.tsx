import { Link } from '@tanstack/react-router'
import { PAGE_SIZE } from '@yahn/schema'
import type { Story } from '@yahn/schema'
import { pluralize, timeAgo } from '../../lib/time.ts'
import styles from './StoryList.module.css'

type StoryListProps = {
  stories: Story[]
  page: number
}

export function StoryList({ stories, page }: StoryListProps) {
  return (
    <ol className={styles.list}>
      {stories.map((story, index) => (
        <StoryRow key={story.id} story={story} rank={(page - 1) * PAGE_SIZE + index + 1} />
      ))}
    </ol>
  )
}

type StoryRowProps = {
  story: Story
  rank: number
}

function StoryRow({ story, rank }: StoryRowProps) {
  const commentCount = story.descendants ?? 0
  const iso = new Date(story.time * 1000).toISOString()

  return (
    <li data-testid="story" className={styles.row}>
      <span className={styles.rank}>{rank}.</span>
      <div className={styles.content}>
        <div className={styles.titleLine}>
          {story.url ? (
            <a data-testid="story-title" href={story.url} rel="noreferrer" className={styles.title}>
              {story.title}
            </a>
          ) : (
            <Link
              data-testid="story-title"
              to="/item/$id"
              params={{ id: story.id }}
              className={styles.title}
            >
              {story.title}
            </Link>
          )}
          {story.host && <span className={styles.host}>({story.host})</span>}
        </div>
        <div className={styles.subtext}>
          {story.score !== null && <span data-testid="story-score">{pluralize(story.score, 'point')}</span>}
          {story.by && <span>by {story.by}</span>}
          <time dateTime={iso}>{timeAgo(story.time)}</time>
          <Link data-testid="story-comments" to="/item/$id" params={{ id: story.id }} className={styles.comments}>
            {pluralize(commentCount, 'comment')}
          </Link>
        </div>
      </div>
    </li>
  )
}
