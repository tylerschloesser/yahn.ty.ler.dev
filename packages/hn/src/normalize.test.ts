import { CommentSchema, StorySchema } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import type { AlgoliaNode, AlgoliaStoryHit } from './algolia/types.ts'
import type { FirebaseItem } from './firebase/types.ts'
import {
  commentFromAlgoliaNode,
  commentFromFirebase,
  storyFromAlgoliaHit,
  storyFromFirebase,
} from './normalize.ts'

describe('storyFromFirebase', () => {
  // Verbatim item/8863.json from docs/hn-api.md.
  it('normalizes the README\'s verbatim story example', () => {
    const item: FirebaseItem = {
      by: 'dhouston',
      descendants: 71,
      id: 8863,
      kids: [8952, 9224, 8917, 8884, 8887],
      score: 111,
      time: 1175714200,
      title: 'My YC app: Dropbox - Throw away your USB drive',
      type: 'story',
      url: 'http://www.getdropbox.com/u/2/screencast.html',
    }
    const story = StorySchema.parse(storyFromFirebase(item))
    expect(story.kind).toBe('story')
    expect(story.url).toBe('http://www.getdropbox.com/u/2/screencast.html')
    expect(story.host).toBe('getdropbox.com')
    expect(story.text).toBeNull()
    expect(story.score).toBe(111)
    expect(story.descendants).toBe(71)
    expect(story.deleted).toBe(false)
    expect(story.dead).toBe(false)
  })

  // Ask HN story (item/121003 fields, per docs/hn-api.md): text, no url.
  it('normalizes an Ask HN story as a self post with no url', () => {
    const item: FirebaseItem = {
      by: 'tel',
      descendants: 16,
      id: 121003,
      kids: [121016],
      score: 25,
      text: 'Something I have been curious about.',
      time: 1203647620,
      title: 'Ask HN: The Arc Effect',
      type: 'story',
    }
    const story = StorySchema.parse(storyFromFirebase(item))
    expect(story.kind).toBe('story')
    expect(story.url).toBeNull()
    expect(story.host).toBeNull()
    expect(story.text).toBe('Something I have been curious about.')
  })

  // Job (item/192327 fields, per docs/hn-api.md): url: "" normalizes to null.
  it('normalizes a job with url: "" as a null url', () => {
    const item: FirebaseItem = {
      by: 'justin',
      id: 192327,
      score: 6,
      text: 'Justin.tv is the biggest live video site online.',
      time: 1210981217,
      title: 'Justin.tv is looking for a Lead Flash Engineer!',
      type: 'job',
      url: '',
    }
    const story = StorySchema.parse(storyFromFirebase(item))
    expect(story.kind).toBe('job')
    expect(story.url).toBeNull()
    expect(story.host).toBeNull()
    expect(story.score).toBe(6)
    expect(story.descendants).toBeNull()
  })

  // Verbatim item/126809.json from docs/hn-api.md.
  it('normalizes a poll', () => {
    const item: FirebaseItem = {
      by: 'pg',
      descendants: 54,
      id: 126809,
      kids: [126822, 126823, 126993, 126824, 126934, 127411, 126888, 127681, 126818],
      parts: [126810, 126811, 126812],
      score: 46,
      text: '',
      time: 1204403652,
      title: 'Poll: What would happen if News.YC had explicit support for polls?',
      type: 'poll',
    }
    const story = StorySchema.parse(storyFromFirebase(item))
    expect(story.kind).toBe('poll')
    expect(story.url).toBeNull()
    expect(story.text).toBe('')
    expect(story.descendants).toBe(54)
  })
})

describe('commentFromFirebase', () => {
  // Verbatim item/2921983.json from docs/hn-api.md.
  it('normalizes a regular comment', () => {
    const item: FirebaseItem = {
      by: 'norvig',
      id: 2921983,
      kids: [2922097, 2922429, 2924562, 2922709, 2922573, 2922140, 2922141],
      parent: 2921506,
      text:
        'Aw shucks, guys ... you make me blush with your compliments.<p>Tell you what, ' +
        'Ill make a deal: I\'ll keep writing if you keep reading. K?',
      time: 1314211127,
      type: 'comment',
    }
    const comment = CommentSchema.parse(commentFromFirebase(item, []))
    expect(comment.by).toBe('norvig')
    expect(comment.parent).toBe(2921506)
    expect(comment.deleted).toBe(false)
    expect(comment.dead).toBe(false)
  })

  // Verbatim deleted-comment tombstone from docs/hn-api.md.
  it('normalizes the verbatim deleted-comment tombstone', () => {
    const item: FirebaseItem = {
      deleted: true,
      id: 49578685,
      parent: 49576305,
      time: 1788629312,
      type: 'comment',
    }
    const comment = CommentSchema.parse(commentFromFirebase(item, []))
    expect(comment.deleted).toBe(true)
    expect(comment.by).toBeNull()
    expect(comment.text).toBeNull()
  })

  // Verbatim dead-comment tombstone from docs/hn-api.md: by and text survive.
  it('normalizes the verbatim dead-comment tombstone, keeping by and text', () => {
    const item: FirebaseItem = {
      by: 'flaviopilotodas',
      dead: true,
      id: 49578709,
      parent: 49578708,
      text: '[flagged]',
      time: 1788629415,
      type: 'comment',
    }
    const comment = CommentSchema.parse(commentFromFirebase(item, []))
    expect(comment.dead).toBe(true)
    expect(comment.by).toBe('flaviopilotodas')
    expect(comment.text).toBe('[flagged]')
  })
})

describe('storyFromAlgoliaHit', () => {
  it('normalizes a story hit', () => {
    const hit: AlgoliaStoryHit = {
      objectID: '22238335',
      title: 'Why Discord is switching from Go to Rust',
      url: 'https://discord.com/blog/why-discord-is-switching-from-go-to-rust',
      author: 'Sikul',
      points: 500,
      story_text: null,
      num_comments: 300,
      created_at: '2020-02-06T18:02:00.000Z',
      created_at_i: 1581012120,
      updated_at: '2023-09-07T03:22:05.000Z',
      children: [22238400],
      story_id: 22238335,
      _tags: ['story', 'author_Sikul', 'story_22238335'],
    }
    const story = StorySchema.parse(storyFromAlgoliaHit(hit))
    expect(story.id).toBe(22238335)
    expect(story.kind).toBe('story')
    expect(story.host).toBe('discord.com')
    expect(story.score).toBe(500)
    expect(story.descendants).toBe(300)
  })
})

describe('commentFromAlgoliaNode', () => {
  it('normalizes a recursive node tree', () => {
    const node: AlgoliaNode = {
      id: 8863,
      created_at: '2007-04-04T09:56:40.000Z',
      created_at_i: 1175714200,
      type: 'story',
      author: 'dhouston',
      title: 'My YC app: Dropbox - Throw away your USB drive',
      url: 'http://www.getdropbox.com/u/2/screencast.html',
      text: null,
      points: 111,
      parent_id: null,
      story_id: 8863,
      options: [],
      children: [
        {
          id: 8952,
          created_at: '2007-04-04T10:03:20.000Z',
          created_at_i: 1175714600,
          type: 'comment',
          author: 'alice',
          title: null,
          url: null,
          text: 'a reply',
          points: null,
          parent_id: 8863,
          story_id: 8863,
          options: [],
          children: [],
        },
      ],
    }
    const comment = CommentSchema.parse(commentFromAlgoliaNode(node))
    expect(comment.id).toBe(8863)
    expect(comment.by).toBe('dhouston')
    expect(comment.children).toHaveLength(1)
    expect(comment.children[0]?.by).toBe('alice')
    expect(comment.children[0]?.text).toBe('a reply')
    expect(comment.children[0]?.parent).toBe(8863)
  })
})
