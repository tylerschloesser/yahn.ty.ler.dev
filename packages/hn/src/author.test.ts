import { AuthorItemSchema } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import type { AlgoliaAuthorHit } from './algolia/types.ts'
import { authorItemFromAlgoliaHit } from './normalize.ts'

// getAuthorItems itself is a thin pass-through over algolia.getAuthorItems,
// which has no injection seam (unlike getFeed's deps) — the logic worth
// testing offline is authorItemFromAlgoliaHit, per docs/hn-api.md's measured
// hit shapes.
describe('authorItemFromAlgoliaHit', () => {
  it('normalizes a link-story hit with story_text absent', () => {
    const hit: AlgoliaAuthorHit = {
      objectID: '39662615',
      title: 'Some link story',
      url: 'https://example.com/post',
      author: 'pg',
      points: 42,
      num_comments: 7,
      created_at_i: 1700000000,
      _tags: ['story', 'author_pg', 'story_39662615'],
      // story_text intentionally absent, not null.
    }
    const item = AuthorItemSchema.parse(authorItemFromAlgoliaHit(hit))
    expect(item.kind).toBe('story')
    expect(item.text).toBeNull()
    expect(item.score).toBe(42)
    expect(item.descendants).toBe(7)
    expect(item.host).toBe('example.com')
    expect(item.storyId).toBe(item.id)
  })

  it('normalizes a self-post story hit with url absent', () => {
    const hit: AlgoliaAuthorHit = {
      objectID: '37278345',
      title: 'Ask HN: something',
      author: 'pg',
      story_text: 'the body',
      points: 10,
      num_comments: 3,
      created_at_i: 1700000001,
      _tags: ['story', 'author_pg', 'story_37278345'],
      // url intentionally absent.
    }
    const item = AuthorItemSchema.parse(authorItemFromAlgoliaHit(hit))
    expect(item.kind).toBe('story')
    expect(item.url).toBeNull()
    expect(item.host).toBeNull()
    expect(item.text).toBe('the body')
  })

  it('normalizes a comment hit', () => {
    const hit: AlgoliaAuthorHit = {
      objectID: '9999999',
      comment_text: 'a reply',
      author: 'pg',
      parent_id: 9999826,
      story_id: 9998227,
      story_title: 'Why Write Python in Visual Studio?',
      story_url: 'http://blogs.msdn.com/b/visualstudio/archive/2015/08/03/why.aspx',
      points: null,
      created_at_i: 1438637521,
      _tags: ['comment', 'author_pg', 'story_9998227'],
    }
    const item = AuthorItemSchema.parse(authorItemFromAlgoliaHit(hit))
    expect(item.kind).toBe('comment')
    expect(item.title).toBe('Why Write Python in Visual Studio?')
    expect(item.url).toBeNull()
    expect(item.host).toBeNull()
    expect(item.score).toBeNull()
    expect(item.descendants).toBeNull()
    expect(item.storyId).toBe(9998227)
  })

  it('parses both with children absent and with children present', () => {
    const withoutChildren: AlgoliaAuthorHit = {
      objectID: '1',
      created_at_i: 1700000002,
      _tags: ['story', 'author_pg', 'story_1'],
    }
    const withChildren: AlgoliaAuthorHit = {
      objectID: '2',
      created_at_i: 1700000003,
      _tags: ['story', 'author_pg', 'story_2'],
      children: [3, 4],
    }
    expect(() => AuthorItemSchema.parse(authorItemFromAlgoliaHit(withoutChildren))).not.toThrow()
    expect(() => AuthorItemSchema.parse(authorItemFromAlgoliaHit(withChildren))).not.toThrow()
  })

  it('treats a show_hn hit as a story', () => {
    const hit: AlgoliaAuthorHit = {
      objectID: '5',
      title: 'Show HN: a thing',
      created_at_i: 1700000004,
      _tags: ['show_hn', 'story', 'author_pg', 'story_5'],
    }
    const item = AuthorItemSchema.parse(authorItemFromAlgoliaHit(hit))
    expect(item.kind).toBe('story')
  })
})
