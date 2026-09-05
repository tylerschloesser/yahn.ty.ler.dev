import { Link } from '@tanstack/react-router'
import type { Story } from '@yahn/schema'
import { sanitizeHnHtml } from '../../lib/html.ts'
import { pluralize, timeAgo } from '../../lib/time.ts'
import styles from './StoryHeader.module.css'

type StoryHeaderProps = {
  story: Story
  truncated: boolean
}

export function StoryHeader({ story, truncated }: StoryHeaderProps) {
  const commentCount = story.descendants ?? 0
  const iso = new Date(story.time * 1000).toISOString()

  return (
    <header className={styles.header}>
      <div className={styles.titleLine}>
        {story.url ? (
          <h1 className={styles.title}>
            <a data-testid="story-title" href={story.url} rel="noreferrer" className={styles.link}>
              {story.title}
            </a>
          </h1>
        ) : (
          <h1 data-testid="story-title" className={styles.title}>
            {story.title}
          </h1>
        )}
        {story.host && <span className={styles.host}>({story.host})</span>}
      </div>
      <div className={styles.subtext}>
        {story.score !== null && <span data-testid="story-score">{pluralize(story.score, 'point')}</span>}
        {story.by && (
          <span>
            by{' '}
            <Link to="/user/$id" params={{ id: story.by }} className={styles.author}>
              {story.by}
            </Link>
          </span>
        )}
        <time dateTime={iso}>{timeAgo(story.time)}</time>
        <span>{pluralize(commentCount, 'comment')}</span>
      </div>
      {truncated && (
        <output className={styles.truncated}>
          This thread is larger than what loaded — the comments below are a prefix of the full tree.
        </output>
      )}
      {story.text && (
        // Third-party HTML from Hacker News. sanitizeHnHtml is what makes
        // this safe: it allowlists a small set of inline tags and only ever
        // keeps an http(s) href on <a>, forcing rel="nofollow noreferrer".
        <div className={styles.body} dangerouslySetInnerHTML={{ __html: sanitizeHnHtml(story.text) }} />
      )}
    </header>
  )
}
