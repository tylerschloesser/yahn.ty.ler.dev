import { describe, expect, it } from 'vitest'
import { hostFromUrl } from './host.ts'

describe('hostFromUrl', () => {
  it('strips a leading www.', () => {
    expect(hostFromUrl('https://www.example.com/path')).toBe('example.com')
  })

  it('keeps other subdomains', () => {
    expect(hostFromUrl('https://blog.example.com/path')).toBe('blog.example.com')
  })

  it('lowercases an uppercase host', () => {
    expect(hostFromUrl('https://EXAMPLE.com/path')).toBe('example.com')
  })

  it('returns null for null', () => {
    expect(hostFromUrl(null)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(hostFromUrl('')).toBeNull()
  })

  it('returns null for a garbage/unparseable url', () => {
    expect(hostFromUrl('not a url')).toBeNull()
  })
})
