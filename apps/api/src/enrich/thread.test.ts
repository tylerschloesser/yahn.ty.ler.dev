import { CommentSchema, StorySchema } from '@yahn/schema'
import type { Comment, Story } from '@yahn/schema'
import { describe, expect, it } from 'vitest'
import { htmlToText, inputKey, renderThread } from './thread.ts'

// Verbatim story example, item/8863 (docs/hn-api.md ~line 168), adapted to
// the normalized shape this API actually returns.
function story(overrides: Partial<Story> = {}): Story {
  return StorySchema.parse({
    id: 8863,
    by: 'dhouston',
    time: 1175714200,
    contentKey: 'storycontentkey',
    deleted: false,
    dead: false,
    kind: 'story',
    title: 'My YC app: Dropbox - Throw away your USB drive',
    url: 'http://www.getdropbox.com/u/2/screencast.html',
    host: 'getdropbox.com',
    text: null,
    score: 111,
    descendants: 71,
    ...overrides,
  })
}

function comment(overrides: Partial<Comment> & { id: number }): Comment {
  return CommentSchema.parse({
    by: 'someone',
    time: 1314211127,
    contentKey: 'commentcontentkey',
    deleted: false,
    dead: false,
    text: 'a comment',
    parent: 8863,
    children: [],
    ...overrides,
  })
}

// Verbatim comment text, item/2921983 (docs/hn-api.md ~line 192).
const NORVIG_TEXT =
  "Aw shucks, guys ... you make me blush with your compliments.<p>Tell you what, Ill make a deal: I'll keep writing if you keep reading. K?"

describe('renderThread', () => {
  it('full renders every non-tombstoned comment', () => {
    const c1 = comment({ id: 1, by: 'norvig', text: NORVIG_TEXT, children: [comment({ id: 2 })] })
    const c2 = comment({ id: 3 })
    const result = renderThread(story(), [c1, c2], { strategy: 'full' })

    expect(result.totalComments).toBe(3)
    expect(result.comments).toBe(3)
    expect(result.text).toContain('[1] norvig:')
    expect(result.text).toContain('[2] someone:')
    expect(result.text).toContain('[3] someone:')
  })

  it('top-level renders only depth 0 comments', () => {
    const child = comment({ id: 2 })
    const c1 = comment({ id: 1, children: [child] })
    const c2 = comment({ id: 3 })
    const result = renderThread(story(), [c1, c2], { strategy: 'top-level' })

    expect(result.comments).toBe(2)
    expect(result.totalComments).toBe(3)
    expect(result.text).not.toContain('[2]')
  })

  it('budget renders fewer comments than full and stays within its char budget', () => {
    const longText = 'x'.repeat(200)
    const tree = [
      comment({ id: 1, text: longText }),
      comment({ id: 2, text: longText }),
      comment({ id: 3, text: longText }),
      comment({ id: 4, text: longText }),
    ]
    const full = renderThread(story(), tree, { strategy: 'full' })

    // Big enough for the header plus three of the four long comments, too
    // small for all four.
    const budgetChars = 800
    const budget = renderThread(story(), tree, { strategy: 'budget', budgetChars })

    expect(budget.comments).toBeLessThan(full.comments)
    expect(budget.comments).toBeGreaterThan(0)
    expect(budget.chars).toBeLessThanOrEqual(budgetChars)
  })

  it('budget admits exactly one comment when the first alone exceeds the budget', () => {
    const huge = comment({ id: 1, text: 'x'.repeat(10_000) })
    const second = comment({ id: 2, text: 'short' })
    const result = renderThread(story(), [huge, second], { strategy: 'budget', budgetChars: 10 })

    expect(result.comments).toBe(1)
    expect(result.text).toContain('[1]')
    expect(result.text).not.toContain('[2]')
  })

  it('a tombstoned comment contributes no line but its children render at its own depth', () => {
    // Verbatim deleted tombstone, docs/hn-api.md "Deleted and dead tombstones".
    const child = comment({ id: 2921983, by: 'norvig', text: NORVIG_TEXT, parent: 49578685 })
    const tombstone = comment({
      id: 49578685,
      by: null,
      deleted: true,
      text: null,
      parent: 49576305,
      children: [child],
    })
    const result = renderThread(story(), [tombstone], { strategy: 'full' })

    expect(result.totalComments).toBe(2)
    expect(result.comments).toBe(1)
    expect(result.text).not.toContain('49578685')
    // Rendered at depth 0, the tombstone's own depth — not indented as a reply.
    expect(result.text).toContain('[2921983] norvig:')
    expect(result.text).not.toContain('  [2921983]')
  })

  it('a dead comment is also a tombstone: no line, children still render', () => {
    // Verbatim dead tombstone, docs/hn-api.md "Deleted and dead tombstones".
    const dead = comment({
      id: 49578709,
      by: 'flaviopilotodas',
      dead: true,
      text: '[flagged]',
      parent: 49578708,
      children: [comment({ id: 50000000 })],
    })
    const result = renderThread(story(), [dead], { strategy: 'full' })

    expect(result.comments).toBe(1)
    expect(result.text).not.toContain('flaviopilotodas')
    expect(result.text).toContain('[50000000]')
  })

  it('preserves sibling order and never sorts', () => {
    const tree = [comment({ id: 30 }), comment({ id: 10 }), comment({ id: 20 })]
    const result = renderThread(story(), tree, { strategy: 'full' })

    const positions = [30, 10, 20].map((id) => result.text.indexOf(`[${id}]`))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('omits the URL line when url is null, and includes story text when present', () => {
    const linkStory = story()
    const selfPost = story({ url: null, host: null, text: NORVIG_TEXT })

    const linkResult = renderThread(linkStory, [], { strategy: 'full' })
    const selfResult = renderThread(selfPost, [], { strategy: 'full' })

    expect(linkResult.text).toContain('URL: http://www.getdropbox.com/u/2/screencast.html')
    expect(selfResult.text).not.toContain('URL:')
    expect(selfResult.text).toContain("Tell you what, Ill make a deal")
  })

  it('is a pure function of its arguments', () => {
    const tree = [comment({ id: 1, text: NORVIG_TEXT, children: [comment({ id: 2 })] })]
    const options = { strategy: 'budget' as const, budgetChars: 1000 }
    const a = renderThread(story(), tree, options)
    const b = renderThread(story(), tree, options)

    expect(a.text).toBe(b.text)
    expect(inputKey(a.text)).toBe(inputKey(b.text))
  })
})

describe('inputKey', () => {
  it('is a 16-character hex digest', () => {
    expect(inputKey('hello')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('htmlToText', () => {
  it('turns <p> into a paragraph break and decodes entities, &amp; last', () => {
    expect(htmlToText('one<p>two')).toBe('one\n\ntwo')
    // &amp;lt; must survive as the literal text &lt;, not become <.
    expect(htmlToText('&amp;lt;')).toBe('&lt;')
    expect(htmlToText('Tom &amp; Jerry&#x27;s &quot;show&quot;')).toBe(`Tom & Jerry's "show"`)
  })

  it('strips an <a href> down to its link text', () => {
    expect(htmlToText('see <a href="https://example.com" rel="nofollow">this link</a> please')).toBe(
      'see this link please',
    )
  })

  it('renders the verbatim norvig comment correctly', () => {
    expect(htmlToText(NORVIG_TEXT)).toBe(
      "Aw shucks, guys ... you make me blush with your compliments.\n\nTell you what, Ill make a deal: I'll keep writing if you keep reading. K?",
    )
  })
})
