import { CommentSchema } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import type { AlgoliaNode } from '../algolia/types.ts'
import type { FirebaseItem } from '../firebase/types.ts'
import { mergeAlgoliaTree } from './hybrid.ts'

function node(overrides: Partial<AlgoliaNode> & { id: number }): AlgoliaNode {
  return {
    created_at: '2020-01-01T00:00:00.000Z',
    created_at_i: 1577836800,
    type: 'comment',
    author: `user${overrides.id}`,
    title: null,
    url: null,
    text: `comment ${overrides.id}`,
    points: null,
    parent_id: null,
    story_id: 1,
    options: [],
    children: [],
    ...overrides,
  }
}

describe('mergeAlgoliaTree', () => {
  it('reorders the top level by story.kids, overriding Algolia\'s chronological order', () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [30, 10, 20] }
    const root = node({
      id: 1,
      type: 'story',
      // Algolia's own order: ascending by id (chronological).
      children: [node({ id: 10 }), node({ id: 20 }), node({ id: 30 })],
    })

    const { comments, truncated } = mergeAlgoliaTree(story, root)

    expect(truncated).toBe(false)
    expect(comments.map((c) => c.id)).toEqual([30, 10, 20])
    comments.forEach((c) => CommentSchema.parse(c))
  })

  it('appends a top-level node Algolia has but kids does not mention, in Algolia order, rather than dropping it', () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [20, 10] }
    const root = node({
      id: 1,
      type: 'story',
      children: [node({ id: 10 }), node({ id: 20 }), node({ id: 40 })],
    })

    const { comments } = mergeAlgoliaTree(story, root)

    expect(comments.map((c) => c.id)).toEqual([20, 10, 40])
  })

  it('leaves depth-two order exactly as Algolia gave it', () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [10] }
    const root = node({
      id: 1,
      type: 'story',
      children: [
        node({
          id: 10,
          children: [node({ id: 103 }), node({ id: 101 }), node({ id: 102 })],
        }),
      ],
    })

    const { comments } = mergeAlgoliaTree(story, root)

    expect(comments[0]?.children.map((c) => c.id)).toEqual([103, 101, 102])
  })

  it('enforces the node cap depth-first and marks truncated', () => {
    const original = process.env['HN_TREE_NODE_CAP']
    try {
      const story: FirebaseItem = { id: 1, type: 'story', kids: [10, 20] }
      const root = node({
        id: 1,
        type: 'story',
        children: [node({ id: 10 }), node({ id: 20 })],
      })

      process.env['HN_TREE_NODE_CAP'] = '2'
      const atCap = mergeAlgoliaTree(story, root)
      expect(atCap.truncated).toBe(false)
      expect(atCap.comments).toHaveLength(2)

      process.env['HN_TREE_NODE_CAP'] = '1'
      const overCap = mergeAlgoliaTree(story, root)
      expect(overCap.truncated).toBe(true)
      expect(overCap.comments).toHaveLength(1)
    } finally {
      if (original === undefined) delete process.env['HN_TREE_NODE_CAP']
      else process.env['HN_TREE_NODE_CAP'] = original
    }
  })
})
