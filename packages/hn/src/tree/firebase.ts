import type { Comment } from '@yahn/schema'
import { env } from '../env.ts'
import { NotFoundError, UpstreamError } from '../errors.ts'
import * as firebase from '../firebase/client.ts'
import type { FirebaseItem } from '../firebase/types.ts'
import { commentFromFirebase, storyFromFirebase } from '../normalize.ts'
import { mapWithConcurrency } from '../pool.ts'
import type { CommentSource } from './index.ts'

export type LoadedTree = { comments: Comment[]; truncated: boolean }

/**
 * Walks a story's comment tree breadth-first: all of `story.kids`, then all
 * of their kids, and so on, fetching each level with `mapWithConcurrency` at
 * `env.treeConcurrency`. `kids` is HN's ranked display order — the whole
 * reason `firebase` is the default source (`.claude/rules/hn-data.md`) — but
 * BFS itself resolves nodes level-by-level, out of that order, so each
 * parent's `children` array is reassembled afterward by walking that
 * parent's own `kids` through the resolved map, not by push order.
 *
 * `getItem` defaults to `firebase.getItem`. It is a parameter so tests can
 * pass a map-backed fetcher and never touch the network.
 */
export async function loadFirebaseTree(
  story: FirebaseItem,
  getItem: (id: number) => Promise<FirebaseItem> = firebase.getItem,
): Promise<LoadedTree> {
  const resolved = new Map<number, FirebaseItem>()
  let count = 0
  let truncated = false
  let frontier = story.kids ?? []

  while (frontier.length > 0) {
    if (count >= env.treeNodeCap) {
      truncated = true
      break
    }

    // The node cap stops descent, not the whole walk: a partial level is
    // still fetched up to the remaining budget, and the tree comes back as a
    // prefix rather than an empty result or an error.
    const remaining = env.treeNodeCap - count
    const toFetch = frontier.length > remaining ? frontier.slice(0, remaining) : frontier
    if (toFetch.length < frontier.length) truncated = true

    const fetched = await mapWithConcurrency(toFetch, env.treeConcurrency, async (id) => {
      try {
        return await getItem(id)
      } catch (error) {
        // A kid id that doesn't resolve — Firebase's 200+null (NotFoundError)
        // or any other upstream failure — is skipped. One dead child must
        // not fail the whole tree.
        if (error instanceof NotFoundError || error instanceof UpstreamError) return undefined
        throw error
      }
    })

    const nextFrontier: number[] = []
    toFetch.forEach((id, i) => {
      const item = fetched[i]
      if (!item) return
      resolved.set(id, item)
      count += 1
      // A deleted/dead item is a tombstone node, not a hole — it has no
      // `kids`, so recursion ends there naturally rather than being special-cased.
      nextFrontier.push(...(item.kids ?? []))
    })
    frontier = nextFrontier
  }

  function buildChildren(kids: number[] | undefined): Comment[] {
    if (!kids) return []
    const comments: Comment[] = []
    for (const id of kids) {
      const item = resolved.get(id)
      if (!item) continue
      comments.push(commentFromFirebase(item, buildChildren(item.kids)))
    }
    return comments
  }

  return { comments: buildChildren(story.kids), truncated }
}

export function firebaseSource(): CommentSource {
  return {
    name: 'firebase',
    async loadItem(id) {
      const item = await firebase.getItem(id)
      const { comments, truncated } = await loadFirebaseTree(item)
      return { story: storyFromFirebase(item), comments, source: 'firebase', truncated }
    },
  }
}
