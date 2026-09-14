import { describe, expect, it, vi } from 'vitest'
import type { HnDeps } from './app.js'
import { createApp } from './app.js'
import { NotFoundError, UpstreamError } from './hn/index.js'
import type { FeedResponse } from '../shared/schema/index.js'

/**
 * `createApp(fakeDeps)` injects fakes for every HN call, so this file never
 * touches the network — the tree merge, ordering and other real logic live
 * (and are unit-tested) in `server/hn`; this only exercises routing, cache
 * headers and error mapping.
 */

function fakeFeed(): FeedResponse {
  return { feed: 'top', page: 1, pageCount: 1, total: 0, stories: [] }
}

function makeDeps(overrides: Partial<HnDeps> = {}): HnDeps {
  return {
    getFeed: vi.fn(async () => fakeFeed()),
    getItem: vi.fn(async () => {
      throw new Error('not stubbed')
    }),
    getUser: vi.fn(async () => {
      throw new Error('not stubbed')
    }),
    getAuthorItems: vi.fn(async () => {
      throw new Error('not stubbed')
    }),
    search: vi.fn(async () => {
      throw new Error('not stubbed')
    }),
    ...overrides,
  }
}

describe('createApp', () => {
  it('GET /api/v1/feeds/:feed returns 200 with s-maxage=30 and a feed cache tag', async () => {
    const app = createApp(makeDeps())

    const res = await app.request('/api/v1/feeds/top')

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=30, stale-while-revalidate=300')
    expect(res.headers.get('Vercel-Cache-Tag')).toBe('feed:top')
    expect(await res.json()).toEqual(fakeFeed())
  })

  it('maps NotFoundError to a 404 with no-store', async () => {
    const app = createApp(
      makeDeps({
        getItem: vi.fn(async () => {
          throw new NotFoundError('no such item')
        }),
      }),
    )

    const res = await app.request('/api/v1/items/1')

    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'no such item' })
  })

  it('maps UpstreamError to a 502 with no-store', async () => {
    const app = createApp(
      makeDeps({
        getItem: vi.fn(async () => {
          throw new UpstreamError('boom')
        }),
      }),
    )

    const res = await app.request('/api/v1/items/1')

    expect(res.status).toBe(502)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'upstream request failed' })
  })

  it('rejects a bad feed name with 400 and no-store', async () => {
    const app = createApp(makeDeps())

    const res = await app.request('/api/v1/feeds/not-a-feed')

    expect(res.status).toBe(400)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = (await res.json()) as { error: string }
    expect(typeof body.error).toBe('string')
  })

  it('returns 404 JSON for an unknown route', async () => {
    const app = createApp(makeDeps())

    const res = await app.request('/api/v1/x')

    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})
