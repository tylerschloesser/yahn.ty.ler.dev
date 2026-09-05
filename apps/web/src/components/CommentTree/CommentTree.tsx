import { Collapsible } from '@base-ui/react/collapsible'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { Comment } from '@yahn/schema'
import { sanitizeHnHtml } from '../../lib/html.ts'
import { pluralize, timeAgo } from '../../lib/time.ts'
import styles from './CommentTree.module.css'

type CommentTreeProps = {
  comments: Comment[]
  depth?: number
  /** Total descendants per comment id, built once at the root — see `countDescendants`. */
  descendantCounts?: Map<number, number>
}

export function CommentTree({ comments, depth = 0, descendantCounts }: CommentTreeProps) {
  if (comments.length === 0) return null

  // Built once, from whichever call is the root of this render (depth 0),
  // then threaded through unchanged — every deeper call already receives it.
  // That keeps the whole-tree reply count at O(n) instead of a recursive
  // count on every one of a 1,600-node thread's comments.
  const counts = descendantCounts ?? buildDescendantCounts(comments)

  return (
    <ul className={styles.list} {...(depth > 0 ? { 'data-nested': '' } : {})}>
      {comments.map((comment) => (
        <li key={comment.id}>
          <CommentNode comment={comment} depth={depth} descendantCounts={counts} />
        </li>
      ))}
    </ul>
  )
}

function buildDescendantCounts(comments: Comment[]): Map<number, number> {
  const counts = new Map<number, number>()
  countDescendants(comments, counts)
  return counts
}

/** Post-order: each node is visited exactly once, however deep the tree. */
function countDescendants(comments: Comment[], counts: Map<number, number>): number {
  let total = 0
  for (const comment of comments) {
    const childCount = countDescendants(comment.children, counts)
    counts.set(comment.id, childCount)
    total += 1 + childCount
  }
  return total
}

type CommentNodeProps = {
  comment: Comment
  depth: number
  descendantCounts: Map<number, number>
}

export function CommentNode({ comment, depth, descendantCounts }: CommentNodeProps) {
  // Mirrors the (uncontrolled) Collapsible's own state, purely so the meta
  // line can render the right glyph and the hidden-reply count — the
  // collapse/expand behaviour itself belongs entirely to Base UI.
  const [open, setOpen] = useState(true)
  const iso = new Date(comment.time * 1000).toISOString()
  // `deleted` wins if a comment were somehow both — HN's two tombstones are
  // otherwise mutually exclusive. See .claude/rules/hn-data.md: deleted loses
  // `by`/`text`/`kids`, dead keeps them.
  const tombstone = comment.deleted ? 'deleted' : comment.dead ? 'dead' : undefined
  const replyCount = descendantCounts.get(comment.id) ?? 0

  return (
    <article
      data-testid="comment"
      data-comment-id={comment.id}
      {...(tombstone ? { 'data-tombstone': tombstone } : {})}
    >
      <Collapsible.Root className={styles.comment} defaultOpen onOpenChange={setOpen}>
        <div className={styles.meta}>
          {/* First in DOM order, per the spec: a subtree's own toggle must be
              the first `comment-toggle` found inside it, ahead of any nested
              reply's toggle. */}
          <Collapsible.Trigger
            data-testid="comment-toggle"
            className={styles.toggle}
            aria-label={open ? 'Collapse comment' : 'Expand comment'}
          >
            {open ? '[–]' : '[+]'}
          </Collapsible.Trigger>
          {tombstone !== 'deleted' && comment.by && (
            <Link
              data-testid="comment-author"
              to="/user/$id"
              params={{ id: comment.by }}
              className={styles.author}
            >
              {comment.by}
            </Link>
          )}
          <time dateTime={iso}>{timeAgo(comment.time)}</time>
          {tombstone === 'dead' && <span className={styles.deadMarker}>[dead]</span>}
          {!open && replyCount > 0 && (
            <span className={styles.hiddenCount}>({pluralize(replyCount, 'reply')})</span>
          )}
        </div>
        {/* Collapsing hides the body and the replies together — the meta
            line above stays outside this panel, which is what keeps the
            toggle visible and clickable again. */}
        <Collapsible.Panel className={styles.panel}>
          {tombstone === 'deleted' ? (
            <p className={styles.tombstoneText}>[deleted]</p>
          ) : (
            comment.text && (
              // Third-party HTML from Hacker News (and, elsewhere, Algolia).
              // sanitizeHnHtml is what makes this safe: it allowlists a small
              // set of inline tags and only ever keeps an http(s) href on <a>,
              // forcing rel="nofollow noreferrer". A dead comment's text goes
              // through the same path — it is real content, just dimmed.
              <div className={styles.body} dangerouslySetInnerHTML={{ __html: sanitizeHnHtml(comment.text) }} />
            )
          )}
          <CommentTree comments={comment.children} depth={depth + 1} descendantCounts={descendantCounts} />
        </Collapsible.Panel>
      </Collapsible.Root>
    </article>
  )
}
