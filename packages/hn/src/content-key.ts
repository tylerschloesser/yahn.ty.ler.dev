import { createHash } from 'node:crypto'

/**
 * The key an enrichment is cached against — see `Story.contentKey` in
 * `@yahn/schema`. `url` wins when both are present; a self post has no url
 * so falls back to `text`; both null still produces a stable hash of `''`.
 */
export function contentKey(url: string | null, text: string | null): string {
  return createHash('sha256')
    .update(url ?? text ?? '')
    .digest('hex')
    .slice(0, 16)
}
