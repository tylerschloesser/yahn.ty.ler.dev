import type { Comment, Story } from '@yahn/schema'
import type { AlgoliaNode, AlgoliaStoryHit } from './algolia/types.ts'
import { contentKey } from './content-key.ts'
import type { FirebaseItem } from './firebase/types.ts'
import { hostFromUrl } from './host.ts'

// There is no "ask" or "show" item type on either API: Ask HN and Show HN
// posts are `type: "story"`, distinguished only by a title prefix.
function kindFromFirebaseType(type: FirebaseItem['type']): Story['kind'] {
  if (type === 'job') return 'job'
  if (type === 'poll') return 'poll'
  return 'story'
}

// An empty string is not a url: the README's job example carries `"url": ""`.
// Normalize '' and undefined alike to null.
function normalizeUrl(url: string | null | undefined): string | null {
  return url ? url : null
}

export function storyFromFirebase(item: FirebaseItem): Story {
  const deleted = item.deleted === true
  const url = normalizeUrl(item.url)
  const text = deleted ? null : (item.text ?? null)

  return {
    id: item.id,
    // A deleted item loses `by`, `text` and `kids`; a dead one keeps them.
    by: deleted ? null : (item.by ?? null),
    time: item.time ?? 0,
    contentKey: contentKey(url, text),
    deleted,
    dead: item.dead === true,
    kind: kindFromFirebaseType(item.type),
    title: item.title ?? '',
    url,
    host: hostFromUrl(url),
    text,
    score: item.score ?? null,
    // The total subtree count, passed through — never computed from `kids`.
    descendants: item.descendants ?? null,
  }
}

export function commentFromFirebase(item: FirebaseItem, children: Comment[]): Comment {
  const deleted = item.deleted === true
  const text = deleted ? null : (item.text ?? null)

  return {
    id: item.id,
    by: deleted ? null : (item.by ?? null),
    time: item.time ?? 0,
    contentKey: contentKey(null, text),
    deleted,
    dead: item.dead === true,
    text,
    parent: item.parent ?? null,
    children,
  }
}

export function storyFromAlgoliaHit(hit: AlgoliaStoryHit): Story {
  const url = normalizeUrl(hit.url)
  const text = hit.story_text ?? null
  const tags = hit._tags

  return {
    id: Number(hit.objectID),
    by: hit.author ?? null,
    time: hit.created_at_i,
    contentKey: contentKey(url, text),
    // Algolia's hit shape has no deleted/dead flag (not covered by
    // docs/hn-api.md) — a search hit is never a tombstone in practice.
    deleted: false,
    dead: false,
    // `poll` is in Algolia's documented tag vocabulary; `job` is not, and
    // docs/hn-api.md does not say how a job post is tagged. The `job` branch
    // is a best guess that costs nothing if it never matches — a job would
    // then read as a story, which is how HN's own search renders it anyway.
    kind: tags.includes('job') ? 'job' : tags.includes('poll') ? 'poll' : 'story',
    title: hit.title,
    url,
    host: hostFromUrl(url),
    text,
    score: hit.points ?? null,
    descendants: hit.num_comments ?? null,
  }
}

export function commentFromAlgoliaNode(node: AlgoliaNode): Comment {
  return {
    id: node.id,
    by: node.author,
    time: node.created_at_i,
    contentKey: contentKey(null, node.text),
    deleted: false,
    dead: false,
    text: node.text,
    parent: node.parent_id,
    // Algolia comment nodes always carry points: null — never map a comment
    // score from Algolia; that's why Comment has no score field at all.
    children: node.children.map(commentFromAlgoliaNode),
  }
}
