import type { CommentSourceName, ItemResponse } from '../../../shared/schema/index.js'
import { env } from '../env.js'
import { firebaseSource } from './firebase.js'
import { hybridSource } from './hybrid.js'

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
