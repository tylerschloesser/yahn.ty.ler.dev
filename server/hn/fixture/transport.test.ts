import { describe, expect, it } from 'vitest'
import { UpstreamError } from '../errors.js'
import { createFixtureTransport, fixtureKey } from './transport.js'

describe('fixtureKey', () => {
  it('drops scheme and host, keeping pathname and query', () => {
    expect(fixtureKey('https://hacker-news.firebaseio.com/v0/item/1.json')).toBe('/v0/item/1.json')
  })

  it('sorts query params so record and lookup order never have to match', () => {
    const a = fixtureKey('https://hn.algolia.com/api/v1/search?tags=story&query=foo')
    const b = fixtureKey('https://hn.algolia.com/api/v1/search?query=foo&tags=story')
    expect(a).toBe(b)
    expect(a).toBe('/api/v1/search?query=foo&tags=story')
  })

  it('omits the "?" entirely for a url with no query string', () => {
    expect(fixtureKey('https://hacker-news.firebaseio.com/v0/topstories.json')).toBe('/v0/topstories.json')
  })
})

describe('createFixtureTransport', () => {
  it('resolves a firebase url from the firebase map', async () => {
    const transport = createFixtureTransport({
      firebase: { '/v0/item/1.json': { id: 1, type: 'story' } },
      algolia: {},
    })
    const result = await transport('https://hacker-news.firebaseio.com/v0/item/1.json')
    expect(result).toEqual({ status: 200, body: { id: 1, type: 'story' }, etag: null })
  })

  it('resolves an algolia url from the algolia map', async () => {
    const transport = createFixtureTransport({
      firebase: {},
      algolia: { '/api/v1/items/1': { id: '1', type: 'story' } },
    })
    const result = await transport('https://hn.algolia.com/api/v1/items/1')
    expect(result).toEqual({ status: 200, body: { id: '1', type: 'story' }, etag: null })
  })

  it('serves a null-recorded key as a recorded miss, not a throw', async () => {
    const transport = createFixtureTransport({
      firebase: { '/v0/item/999.json': null },
      algolia: {},
    })
    const result = await transport('https://hacker-news.firebaseio.com/v0/item/999.json')
    expect(result).toEqual({ status: 200, body: null, etag: null })
  })

  it('ignores If-None-Match entirely — there is no headers parameter to honour it with', async () => {
    const transport = createFixtureTransport({
      firebase: { '/v0/topstories.json': [1, 2, 3] },
      algolia: {},
    })
    const result = await transport('https://hacker-news.firebaseio.com/v0/topstories.json')
    expect(result.body).toEqual([1, 2, 3])
  })

  it('throws UpstreamError naming the url when the key was never recorded', async () => {
    const transport = createFixtureTransport({ firebase: {}, algolia: {} })
    const url = 'https://hacker-news.firebaseio.com/v0/item/42.json'
    await expect(transport(url)).rejects.toThrow(UpstreamError)
    await expect(transport(url)).rejects.toThrow(url)
  })

  it('matches query params regardless of the order they were built in', async () => {
    const transport = createFixtureTransport({
      firebase: {},
      algolia: { '/api/v1/search_by_date?hitsPerPage=30&page=0&tags=author_pg': { hits: [] } },
    })
    const result = await transport(
      'https://hn.algolia.com/api/v1/search_by_date?tags=author_pg&page=0&hitsPerPage=30',
    )
    expect(result.body).toEqual({ hits: [] })
  })
})
