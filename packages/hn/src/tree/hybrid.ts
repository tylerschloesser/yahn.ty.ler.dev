import type { Comment } from '@yahn/schema'
import * as algolia from '../algolia/client.ts'
import type { AlgoliaNode } from '../algolia/types.ts'
import { env } from '../env.ts'
import * as firebase from '../firebase/client.ts'
import type { FirebaseItem } from '../firebase/types.ts'
import { commentFromAlgoliaNode, storyFromFirebase } from '../normalize.ts'
import type { CommentSource } from './index.ts'
import { loadFirebaseTree, type LoadedTree } from './firebase.ts'

// Counts nodes depth-first and drops whatever exceeds env.treeNodeCap,
// marking `truncated` — a prefix, not an error, same contract as
// loadFirebaseTree's node cap.
function capTree(comments: Comment[]): LoadedTree {
  const cap = env.treeNodeCap
  let count = 0
  let truncated = false

  function walk(nodes: Comment[]): Comment[] {
    const kept: Comment[] = []
    for (const comment of nodes) {
      if (count >= cap) {
        truncated = true
        break
      }
      count += 1
      kept.push({ ...comment, children: walk(comment.children) })
    }
    return kept
  }

  return { comments: walk(comments), truncated }
}

/**
 * Pure — no I/O, fully unit-testable. Builds the tree from Algolia's nested
 * node with `commentFromAlgoliaNode`, then re-orders only the **top level**
 * by `story.kids`: top-level comments in `kids` order first, then anything
 * Algolia had that `kids` did not mention, in Algolia's own order.
 *
 * Nothing below the top level is re-ordered. That is the known limitation
 * the ordering spike measured (`.claude/rules/hn-data.md`): Algolia's nested
 * `children` arrays were strictly ascending by id — chronological, not
 * HN's ranked order — at every depth in every thread sampled. One round
 * trip buys wrong sibling order below the top level; this function does not
 * try to fix that, it only fixes what the top-level `kids` array can.
 */
export function mergeAlgoliaTree(story: FirebaseItem, node: AlgoliaNode): LoadedTree {
  const topLevel = node.children.map(commentFromAlgoliaNode)
  const byId = new Map(topLevel.map((comment) => [comment.id, comment]))

  const ordered: Comment[] = []
  for (const id of story.kids ?? []) {
    const comment = byId.get(id)
    if (comment) {
      ordered.push(comment)
      byId.delete(id)
    }
  }
  for (const comment of topLevel) {
    if (byId.has(comment.id)) ordered.push(comment)
  }

  return capTree(ordered)
}

export function hybridSource(): CommentSource {
  return {
    name: 'hybrid',
    async loadItem(id) {
      // In parallel: the Algolia leg is caught so one round trip failing
      // never blocks the Firebase leg, which always supplies the story and
      // its live score/descendants.
      const [item, algoliaNode] = await Promise.all([
        firebase.getItem(id),
        algolia.getItem(id).catch(() => undefined),
      ])
      const story = storyFromFirebase(item)

      if (!algoliaNode) {
        // Algolia failed or returned nothing — fall back to the Firebase
        // walk using the item already fetched above (no re-fetch), and
        // report the source that actually produced the tree.
        const { comments, truncated } = await loadFirebaseTree(item)
        return { story, comments, source: 'firebase', truncated }
      }

      const { comments, truncated } = mergeAlgoliaTree(item, algoliaNode)
      return { story, comments, source: 'hybrid', truncated }
    },
  }
}
