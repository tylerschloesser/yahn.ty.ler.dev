import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { AuthorItemType, SearchSort } from '@yahn/schema'
import type { FeedPath } from '../../feeds.ts'
import styles from './Pagination.module.css'

/**
 * Where a page link points. A discriminated union rather than a `to` string
 * because TanStack types `params` and `search` per route, so only a literal
 * `<Link to="/user/$id">` gets them checked — the switch in `PageLink` is what
 * keeps that check while letting one component own the control's markup.
 *
 * Note every page here is **1-based**, matching HN's `?p=`. Search and author
 * history are 0-based at the API and are converted in `src/api.ts`, at the one
 * boundary between the two conventions.
 */
export type PageTarget =
  | { kind: 'feed'; to: FeedPath }
  | { kind: 'search'; query: string; sort: SearchSort }
  | { kind: 'author'; id: string; type: AuthorItemType }

type PaginationProps = {
  target: PageTarget
  page: number
  pageCount: number
}

export function Pagination({ target, page, pageCount }: PaginationProps) {
  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {page > 1 ? (
        <PageLink target={target} page={page - 1} testId="page-prev">
          ← Prev
        </PageLink>
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
        <PageLink target={target} page={page + 1} testId="page-next">
          Next →
        </PageLink>
      ) : (
        <span data-testid="page-next" data-disabled="" className={styles.pageLink}>
          Next →
        </span>
      )}
    </nav>
  )
}

type PageLinkProps = {
  target: PageTarget
  page: number
  testId: string
  children: ReactNode
}

function PageLink({ target, page, testId, children }: PageLinkProps) {
  const shared = { 'data-testid': testId, className: styles.pageLink }

  switch (target.kind) {
    case 'feed':
      return (
        <Link to={target.to} search={{ p: page }} {...shared}>
          {children}
        </Link>
      )
    case 'search':
      return (
        <Link to="/search" search={{ q: target.query, sort: target.sort, p: page }} {...shared}>
          {children}
        </Link>
      )
    case 'author':
      return (
        <Link
          to="/user/$id"
          params={{ id: target.id }}
          search={{ type: target.type, p: page }}
          {...shared}
        >
          {children}
        </Link>
      )
  }
}
