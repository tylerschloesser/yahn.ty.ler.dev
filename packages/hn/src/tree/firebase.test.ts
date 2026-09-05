import { CommentSchema } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../errors.ts'
import type { FirebaseItem } from '../firebase/types.ts'
import { firebaseSource, loadFirebaseTree } from './firebase.ts'

function comment(overrides: Partial<FirebaseItem> & { id: number }): FirebaseItem {
  return {
    type: 'comment',
    by: `user${overrides.id}`,
    time: 1000,
    text: `comment ${overrides.id}`,
    ...overrides,
  }
}

// A map-backed fetcher — tests never touch the network (.claude/rules/testing.md).
function mapFetcher(items: Record<number, FirebaseItem>): (id: number) => Promise<FirebaseItem> {
  return async (id: number) => {
    const found = items[id]
    if (!found) throw new NotFoundError(`item ${id} not found`)
    return found
  }
}

describe('loadFirebaseTree', () => {
  it('preserves kids order at the top level and at depth two, even when kids are not id-ascending', async () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [30, 10, 20] }
    const items: Record<number, FirebaseItem> = {
      30: comment({ id: 30, parent: 1, kids: [303, 301, 302] }),
      10: comment({ id: 10, parent: 1 }),
      20: comment({ id: 20, parent: 1 }),
      303: comment({ id: 303, parent: 30 }),
      301: comment({ id: 301, parent: 30 }),
      302: comment({ id: 302, parent: 30 }),
    }

    const { comments, truncated } = await loadFirebaseTree(story, mapFetcher(items))

    expect(truncated).toBe(false)
    expect(comments.map((c) => c.id)).toEqual([30, 10, 20])
    const nodeThirty = comments.find((c) => c.id === 30)
    expect(nodeThirty?.children.map((c) => c.id)).toEqual([303, 301, 302])
    comments.forEach((c) => CommentSchema.parse(c))
  })

  it('stops at the node cap, marks truncated, and returns a prefix rather than an error or empty tree', async () => {
    const original = process.env['HN_TREE_NODE_CAP']
    process.env['HN_TREE_NODE_CAP'] = '2'
    try {
      const story: FirebaseItem = { id: 1, type: 'story', kids: [10, 20, 30] }
      const items: Record<number, FirebaseItem> = {
        10: comment({ id: 10, parent: 1 }),
        20: comment({ id: 20, parent: 1 }),
        30: comment({ id: 30, parent: 1 }),
      }

      const { comments, truncated } = await loadFirebaseTree(story, mapFetcher(items))

      expect(truncated).toBe(true)
      expect(comments.length).toBeGreaterThan(0)
      expect(comments.length).toBeLessThan(3)
    } finally {
      if (original === undefined) delete process.env['HN_TREE_NODE_CAP']
      else process.env['HN_TREE_NODE_CAP'] = original
    }
  })

  it('skips a kid whose fetch throws NotFoundError, keeps its siblings, and leaves truncated false', async () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [10, 999, 20] }
    const items: Record<number, FirebaseItem> = {
      10: comment({ id: 10, parent: 1 }),
      20: comment({ id: 20, parent: 1 }),
      // 999 is deliberately absent, so mapFetcher throws NotFoundError for it.
    }

    const { comments, truncated } = await loadFirebaseTree(story, mapFetcher(items))

    expect(truncated).toBe(false)
    expect(comments.map((c) => c.id)).toEqual([10, 20])
  })

  it('renders the verbatim deleted- and dead-comment tombstones as Comments, not holes', async () => {
    const story: FirebaseItem = { id: 1, type: 'story', kids: [49578685, 49578709] }
    // Verbatim from docs/hn-api.md.
    const items: Record<number, FirebaseItem> = {
      49578685: {
        deleted: true,
        id: 49578685,
        parent: 49576305,
        time: 1788629312,
        type: 'comment',
      },
      49578709: {
        by: 'flaviopilotodas',
        dead: true,
        id: 49578709,
        parent: 49578708,
        text: '[flagged]',
        time: 1788629415,
        type: 'comment',
      },
    }

    const { comments, truncated } = await loadFirebaseTree(story, mapFetcher(items))

    expect(truncated).toBe(false)
    expect(comments).toHaveLength(2)

    const deletedComment = comments[0]
    expect(deletedComment?.deleted).toBe(true)
    expect(deletedComment?.by).toBeNull()
    expect(deletedComment?.text).toBeNull()

    const deadComment = comments[1]
    expect(deadComment?.dead).toBe(true)
    expect(deadComment?.by).toBe('flaviopilotodas')
    expect(deadComment?.text).toBe('[flagged]')

    comments.forEach((c) => CommentSchema.parse(c))
  })
})

describe('firebaseSource', () => {
  it('is named "firebase"', () => {
    expect(firebaseSource().name).toBe('firebase')
  })
})
