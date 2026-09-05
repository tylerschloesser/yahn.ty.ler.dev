import type { CommentSourceName, ItemResponse } from '@yahn/schema'
import { env } from '../env.ts'
import { firebaseSource } from './firebase.ts'
import { hybridSource } from './hybrid.ts'

export type CommentSource = {
  name: CommentSourceName
  loadItem(id: number): Promise<ItemResponse>
}

let cached: CommentSource | undefined

/**
 * The seam that makes flipping the comment source a one-line change: set
 * `COMMENT_SOURCE=hybrid` and nothing above this module has to know. The
 * default itself lives in `env.ts`, set by the ordering spike recorded in
 * `.claude/rules/hn-data.md` ('firebase' — Algolia's `children` were found
 * to be chronological, not HN's ranked order, at every depth).
 *
 * Lazy (`cached ??= …`) so importing this module constructs no client, and a
 * test can set env before the first call — the same seam as
 * thai.ler.dev's `getStore()`.
 */
export function getCommentSource(): CommentSource {
  cached ??= env.commentSource === 'hybrid' ? hybridSource() : firebaseSource()
  return cached
}
