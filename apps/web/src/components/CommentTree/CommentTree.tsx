import type { Comment } from '@yahn/schema'
import { sanitizeHnHtml } from '../../lib/html.ts'
import { timeAgo } from '../../lib/time.ts'
import styles from './CommentTree.module.css'

type CommentTreeProps = {
  comments: Comment[]
  depth?: number
}

export function CommentTree({ comments, depth = 0 }: CommentTreeProps) {
  if (comments.length === 0) return null

  return (
    <ul className={styles.list} {...(depth > 0 ? { 'data-nested': '' } : {})}>
      {comments.map((comment) => (
        <li key={comment.id}>
          <CommentNode comment={comment} depth={depth} />
        </li>
      ))}
    </ul>
  )
}

type CommentNodeProps = {
  comment: Comment
  depth: number
}

export function CommentNode({ comment, depth }: CommentNodeProps) {
  const tombstone = comment.deleted || comment.dead
  const iso = new Date(comment.time * 1000).toISOString()

  return (
    <article data-testid="comment" className={styles.comment} {...(tombstone ? { 'data-tombstone': '' } : {})}>
      <div className={styles.meta}>
        {!tombstone && comment.by && <span className={styles.author}>{comment.by}</span>}
        <time dateTime={iso}>{timeAgo(comment.time)}</time>
      </div>
      {tombstone ? (
        <p className={styles.tombstoneText}>{comment.deleted ? '[deleted]' : '[flagged]'}</p>
      ) : (
        comment.text && (
          // Third-party HTML from Hacker News (and, elsewhere, Algolia).
          // sanitizeHnHtml is what makes this safe: it allowlists a small
          // set of inline tags and only ever keeps an http(s) href on <a>,
          // forcing rel="nofollow noreferrer".
          <div className={styles.body} dangerouslySetInnerHTML={{ __html: sanitizeHnHtml(comment.text) }} />
        )
      )}
      <CommentTree comments={comment.children} depth={depth + 1} />
    </article>
  )
}
