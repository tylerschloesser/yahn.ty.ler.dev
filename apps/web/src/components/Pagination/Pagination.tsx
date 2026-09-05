import { Link } from '@tanstack/react-router'
import type { FeedPath } from '../../feeds.ts'
import styles from './Pagination.module.css'

type PaginationProps = {
  to: FeedPath
  page: number
  pageCount: number
}

/**
 * A `to` typed as the union of the six feed paths flows through `Link`'s
 * generic inference because all six declare the identical search schema. If a
 * route with different search params ever wants this control, that stops being
 * true and `to` needs narrowing at the call site rather than a cast here.
 */
export function Pagination({ to, page, pageCount }: PaginationProps) {
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {page > 1 ? (
        <Link to={to} search={{ p: page - 1 }} data-testid="page-prev" className={styles.pageLink}>
          ← Prev
        </Link>
      ) : (
        // Disabled rather than absent: a control that appears and disappears
        // reflows the row it sits in.
        <span data-testid="page-prev" data-disabled="" className={styles.pageLink}>
          ← Prev
        </span>
      )}

      <span data-testid="page-status" className={styles.pageStatus}>
        Page {page} of {pageCount}
      </span>

      {page < pageCount ? (
        <Link to={to} search={{ p: page + 1 }} data-testid="page-next" className={styles.pageLink}>
          Next →
        </Link>
      ) : (
        <span data-testid="page-next" data-disabled="" className={styles.pageLink}>
          Next →
        </span>
      )}
    </nav>
  )
}
