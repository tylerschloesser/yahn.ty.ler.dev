import { expect, test } from '@playwright/test'

/**
 * Search and author profiles, asserted structurally.
 *
 * Both run against live Algolia. A query's *results* change daily, so nothing
 * here asserts what came back — only that a query produces rows shaped like
 * stories, and that an author page produces a profile plus a history.
 *
 * `pg` is the one HN username safe to hard-code: it is Paul Graham's, the
 * account has existed since HN did, and it has thousands of both stories and
 * comments. Any *other* username would be a content assertion in disguise.
 */

const story = '[data-testid="story"]'

test('the header search box runs a query and lists story rows', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('search-input').fill('rust')
  await page.getByTestId('search-input').press('Enter')

  await expect(page).toHaveURL(/\/search\?/)
  // The heading, not the rows: the feed is still mounted while the search
  // loader is in flight.
  await expect(page.getByTestId('search-heading')).toContainText('rust')

  const rows = page.locator(story)
  await expect(rows.first()).toBeVisible()
  // A one-word query against all of HN always has more than one page of hits,
  // so the result list is full rather than a stub.
  await expect(rows).toHaveCount(30)
  await expect(rows.locator('[data-testid="story-title"]')).toHaveCount(30)
})

test('a query with no hits says so instead of rendering an empty list', async ({ page }) => {
  // Algolia tokenizes, so a nonsense *word* is what returns nothing — a
  // nonsense phrase would match on its parts.
  await page.goto('/search?q=zzqqxxjjvvwwkk')
  await expect(page.getByTestId('search-empty')).toBeVisible()
  await expect(page.locator(story)).toHaveCount(0)
})

test('a story byline opens the author profile and their history', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  await page.locator(`${story} [data-testid="story-author"]`).first().click()
  await expect(page).toHaveURL(/\/user\/.+$/)

  await expect(page.getByTestId('user-karma')).toBeVisible()
  await expect(page.getByTestId('user-created')).toBeVisible()

  // Whoever is on the front page has at least the submission that put them
  // there, so a history row is guaranteed without asserting how many.
  await expect(page.getByTestId('author-item').first()).toBeVisible()
})

test('an author history filters to stories and to comments', async ({ page }) => {
  await page.goto('/user/pg')
  await expect(page.getByTestId('user-karma')).toBeVisible()
  await expect(page.getByTestId('author-item').first()).toBeVisible()

  // Every row on a filtered tab is of that kind. `data-kind` on the row is the
  // assertion surface because the visible difference between the two is only
  // styling, and counting the matching rows against *all* rows is what proves
  // the filter narrowed rather than that at least one row happens to match.
  for (const [label, kind] of [
    ['comments', 'comment'],
    ['stories', 'story'],
  ] as const) {
    await page.getByTestId('author-filter').filter({ hasText: label }).click()
    await expect(page).toHaveURL(new RegExp(`type=${kind}`))

    const rows = page.getByTestId('author-item')
    await expect(rows.first()).toBeVisible()
    await expect(page.locator(`[data-testid="author-item"][data-kind="${kind}"]`)).toHaveCount(
      await rows.count(),
    )
  }
})
