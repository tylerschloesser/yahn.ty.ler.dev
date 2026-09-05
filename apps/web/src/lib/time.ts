const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

/** "3 minutes ago", "5 hours ago", "2 days ago" — relative to now. */
export function timeAgo(unixSeconds: number): string {
  const diffSeconds = Math.max(Math.round(Date.now() / 1000) - unixSeconds, 0)
  for (const [unit, secondsInUnit] of UNITS) {
    if (diffSeconds >= secondsInUnit) {
      return formatter.format(-Math.floor(diffSeconds / secondsInUnit), unit)
    }
  }
  return formatter.format(-diffSeconds, 'second')
}

/**
 * "1 comment", "0 comments" — HN's own wording, and it does pluralize.
 * Handles the one irregular shape this app's nouns need: a consonant before
 * a trailing "y" swaps to "ies" ("reply" → "replies") rather than just
 * appending "s" ("replys"). Nouns ending in a vowel + "y" ("day") are regular
 * and fall through to the plain "s" case.
 */
export function pluralize(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`
  const plural = /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`
  return `${count} ${plural}`
}
