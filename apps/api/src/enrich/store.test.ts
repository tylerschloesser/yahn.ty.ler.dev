import { beforeEach, describe, expect, it } from 'vitest'
import type { ThreadSummary } from '@yahn/schema'
import { getStore, type EnrichStore } from './store.ts'

/**
 * The read-through's reuse rule, which is the part of this epoch that a live
 * measurement proved wrong twice before it was right — see the comment at the
 * top of `store.ts`. It is worth a test precisely because both failures were
 * invisible: one over-cached (a stale summary served forever), the other
 * never cached at all (every viewer paying for a fresh generation), and
 * neither raised an error.
 *
 * `STORE=memory` keeps this offline, as every test in this repo must be.
 */

function summary(over: { comments: number; totalComments: number; generatedAt: number; inputKey: string }): ThreadSummary {
  return {
    text: `summary of ${over.comments} comments`,
    model: 'fake',
    generatedAt: over.generatedAt,
    inputKey: over.inputKey,
    input: {
      strategy: 'budget',
      comments: over.comments,
      totalComments: over.totalComments,
      chars: over.comments * 100,
      inputTokens: null,
      outputTokens: null,
    },
  }
}

describe('the enrichment read-through', () => {
  let store: EnrichStore

  beforeEach(() => {
    process.env.STORE = 'memory'
    // `getStore` memoizes per process, so each test needs its own instance.
    store = getStore()
  })

  it('misses on an empty store', async () => {
    expect(await store.read({ itemId: 1, kind: 'thread-summary', inputKey: 'a', totalComments: 10, comments: 10 })).toBeNull()
  })

  it('hits on an exact input key', async () => {
    await store.put(2, 'thread-summary', summary({ comments: 10, totalComments: 10, generatedAt: 100, inputKey: 'a' }))
    const hit = await store.read({ itemId: 2, kind: 'thread-summary', inputKey: 'a', totalComments: 10, comments: 10 })
    expect(hit?.inputKey).toBe('a')
  })

  it('hits a different key when the thread has not grown', async () => {
    // The case that makes the feature work at all: HN reranks continuously, so
    // the exact bytes are never twice the same and an exact-key-only cache
    // would never hit on a real thread.
    await store.put(3, 'thread-summary', summary({ comments: 100, totalComments: 100, generatedAt: 100, inputKey: 'a' }))
    const hit = await store.read({ itemId: 3, kind: 'thread-summary', inputKey: 'b', totalComments: 100, comments: 100 })
    expect(hit?.inputKey).toBe('a')
  })

  it('still hits after growth inside the tolerance', async () => {
    await store.put(4, 'thread-summary', summary({ comments: 100, totalComments: 100, generatedAt: 100, inputKey: 'a' }))
    const hit = await store.read({ itemId: 4, kind: 'thread-summary', inputKey: 'b', totalComments: 110, comments: 110 })
    expect(hit?.inputKey).toBe('a')
  })

  it('misses once the thread has grown past the tolerance', async () => {
    await store.put(5, 'thread-summary', summary({ comments: 100, totalComments: 100, generatedAt: 100, inputKey: 'a' }))
    expect(
      await store.read({ itemId: 5, kind: 'thread-summary', inputKey: 'b', totalComments: 200, comments: 200 }),
    ).toBeNull()
  })

  it('never serves a summary that read far less of the thread than asked for', async () => {
    // The hazard the coverage check exists for: a thin summary must not answer
    // a request for the whole thread. Measured for real before it was fixed.
    await store.put(6, 'thread-summary', summary({ comments: 12, totalComments: 72, generatedAt: 100, inputKey: 'thin' }))
    expect(
      await store.read({ itemId: 6, kind: 'thread-summary', inputKey: 'full', totalComments: 72, comments: 71 }),
    ).toBeNull()
  })

  it('does serve a richer summary to a request for a thinner one', async () => {
    // The reverse is not a hazard: the stored summary covers strictly more of
    // the thread, so reusing it is both cheaper and better.
    await store.put(7, 'thread-summary', summary({ comments: 71, totalComments: 72, generatedAt: 100, inputKey: 'full' }))
    const hit = await store.read({ itemId: 7, kind: 'thread-summary', inputKey: 'thin', totalComments: 72, comments: 12 })
    expect(hit?.inputKey).toBe('full')
  })

  it('prefers the newest usable summary', async () => {
    await store.put(8, 'thread-summary', summary({ comments: 100, totalComments: 100, generatedAt: 100, inputKey: 'old' }))
    await store.put(8, 'thread-summary', summary({ comments: 100, totalComments: 100, generatedAt: 200, inputKey: 'new' }))
    const hit = await store.read({ itemId: 8, kind: 'thread-summary', inputKey: 'x', totalComments: 100, comments: 100 })
    expect(hit?.inputKey).toBe('new')
  })

  it('keeps items separate', async () => {
    await store.put(9, 'thread-summary', summary({ comments: 10, totalComments: 10, generatedAt: 100, inputKey: 'a' }))
    expect(
      await store.read({ itemId: 10, kind: 'thread-summary', inputKey: 'a', totalComments: 10, comments: 10 }),
    ).toBeNull()
  })
})
