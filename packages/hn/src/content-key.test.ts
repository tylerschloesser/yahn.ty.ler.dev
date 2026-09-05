import { describe, expect, it } from 'vitest'
import { contentKey } from './content-key.ts'

describe('contentKey', () => {
  it('is stable for the same input', () => {
    expect(contentKey('https://example.com', null)).toBe(contentKey('https://example.com', null))
  })

  it('differs for different input', () => {
    expect(contentKey('https://example.com', null)).not.toBe(
      contentKey('https://example.org', null),
    )
  })

  it('prefers url over text', () => {
    expect(contentKey('https://example.com', 'some text')).toBe(
      contentKey('https://example.com', null),
    )
  })

  it('is still a 16-char hex string when both inputs are null', () => {
    expect(contentKey(null, null)).toMatch(/^[0-9a-f]{16}$/)
  })
})
