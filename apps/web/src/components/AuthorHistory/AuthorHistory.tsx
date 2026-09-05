import { Link } from '@tanstack/react-router'
import type { AuthorItem, AuthorItemType } from '@yahn/schema'
import { sanitizeHnHtml } from '../../lib/html.ts'
import { pluralize, timeAgo } from '../../lib/time.ts'
import { Pagination } from '../Pagination/Pagination.tsx'
import styles from './AuthorHistory.module.css'

type AuthorHistoryProps = {
  id: string
  type: AuthorItemType
  page: number
  nbPages: number
  items: AuthorItem[]
}

/**
 * Label the spec finds by visible text, mapped to the API's `type` value.
 * Order is deliberate: all, stories, comments.
 */
const FILTERS: Array<{ label: string; value: AuthorItemType }> = [
  { label: 'all', value: 'all' },
  { label: 'stories', value: 'story' },
  { label: 'comments', value: 'comment' },
]

export function AuthorHistory({ id, type, page, nbPages, items }: AuthorHistoryProps) {
  return (
    <div className={styles.history}>
      <nav className={styles.filters} aria-label="Filter history">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            to="/user/$id"
            params={{ id }}
            // A filtered set has a different page count than whatever page
            // was showing, so changing the filter always lands on page 1.
            search={{ type: filter.value, p: 1 }}
            data-testid="author-filter"
            className={styles.filter}
            {...(type === filter.value ? { 'data-active': '' } : {})}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      <ul className={styles.list}>
        {items.map((item) => (
          <AuthorItemRow key={item.id} item={item} />
        ))}
      </ul>
      {/* nbPages, never nbHits / PAGE_SIZE — Algolia clamps nbPages to its
          1,000-hit ceiling, so a control computed from nbHits would link to
          pages that error. See docs/hn-api.md. */}
      <Pagination target={{ kind: 'author', id, type }} page={page} pageCount={nbPages} />
    </div>
  )
}

function AuthorItemRow({ item }: { item: AuthorItem }) {
  const iso = new Date(item.time * 1000).toISOString()

  return (
    <li data-testid="author-item" data-kind={item.kind} className={styles.row}>
      {item.kind === 'story' ? <StoryBody item={item} iso={iso} /> : <CommentBody item={item} iso={iso} />}
    </li>
  )
}

type BodyProps = {
  item: AuthorItem
  iso: string
}

function StoryBody({ item, iso }: BodyProps) {
  return (
    <div className={styles.content}>
      <div className={styles.titleLine}>
        <ItemTitle item={item} />
        {item.host && <span className={styles.host}>({item.host})</span>}
      </div>
      <div className={styles.subtext}>
        {item.score !== null && <span>{pluralize(item.score, 'point')}</span>}
        <span>{pluralize(item.descendants ?? 0, 'comment')}</span>
        <time dateTime={iso}>{timeAgo(item.time)}</time>
      </div>
    </div>
  )
}

function CommentBody({ item, iso }: BodyProps) {
  return (
    <div className={styles.content}>
      {item.text && (
        // Third-party HTML from Algolia, same allowlist as everywhere else
        // HN-flavored HTML reaches dangerouslySetInnerHTML.
        <div className={styles.body} dangerouslySetInnerHTML={{ __html: sanitizeHnHtml(item.text) }} />
      )}
      <div className={styles.subtext}>
        <span>on:</span>
        <ItemTitle item={item} />
        <time dateTime={iso}>{timeAgo(item.time)}</time>
      </div>
    </div>
  )
}

// The story a row's title links to — its own id for a story, the enclosing
// story for a comment. `storyId` is nullable, so a row with none renders
// plain text rather than a broken link.
function ItemTitle({ item }: { item: AuthorItem }) {
  // `title` is nullable too — a comment whose parent story Algolia has no
  // `story_title` for would otherwise render a link with no text, which is a
  // link with no accessible name.
  const title = item.title ?? 'untitled'

  if (item.url) {
    return (
      <a href={item.url} rel="noreferrer" className={styles.title}>
        {title}
      </a>
    )
  }
  if (item.storyId !== null) {
    return (
      <Link to="/item/$id" params={{ id: item.storyId }} className={styles.title}>
        {title}
      </Link>
    )
  }
  return <span className={styles.title}>{title}</span>
}
