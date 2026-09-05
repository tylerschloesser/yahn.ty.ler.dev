import { FeedResponseSchema } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import { NotFoundError } from './errors.ts'
import { getFeed } from './feed.ts'
import type { FirebaseItem } from './firebase/types.ts'

function ids(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

function storyItem(id: number): FirebaseItem {
  return { id, type: 'story', by: `user${id}`, time: 1000, title: `story ${id}`, kids: [] }
}

describe('getFeed', () => {
  it('pages a 55-id list: page 2 returns ids 31-55 and pageCount is 2', async () => {
    const storyIds = ids(55)

    const response = await getFeed('ask', 2, {
      getStoryIds: async () => storyIds,
      getItem: async (id) => storyItem(id),
    })

    FeedResponseSchema.parse(response)
    expect(response.total).toBe(55)
    expect(response.pageCount).toBe(2)
    expect(response.stories.map((s) => s.id)).toEqual(storyIds.slice(30, 55))
  })

  it('throws NotFoundError for a page beyond pageCount', async () => {
    const storyIds = ids(55)

    await expect(
      getFeed('ask', 3, { getStoryIds: async () => storyIds, getItem: async (id) => storyItem(id) }),
    ).rejects.toThrow(NotFoundError)
  })

  it('skips an item whose fetch throws, without failing the whole page', async () => {
    const storyIds = ids(3)

    const response = await getFeed('top', 1, {
      getStoryIds: async () => storyIds,
      getItem: async (id) => {
        if (id === 2) throw new Error('upstream boom')
        return storyItem(id)
      },
    })

    expect(response.stories.map((s) => s.id)).toEqual([1, 3])
  })
})
