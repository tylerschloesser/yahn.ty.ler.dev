import { expect, test, TARGET } from './fixtures.js'
import { readManifest } from './hn-fixture.js'

/**
 * Search and author profiles, asserted structurally.
 *
 * This suite runs against `HN_SOURCE=fixture` (`.claude/rules/testing.md`):
 * an unrecorded URL throws `UpstreamError`, surfacing as a 502. So every
 * test that needs a query or username guaranteed to have a particular
 * outcome reads it from the recorded manifest (`./hn-fixture.ts`) rather
 * than inventing one here — `search.query` is recorded to return rows,
 * `search.emptyQuery` to return none, and `user` to have a profile and a
 * history — and runs for `TARGET === 'local'` only, since a manifest id is
 * only guaranteed to match the local fixtured server. Nothing asserts what
 * those rows or that profile *say*, only their shape.
 */

const story = '[data-testid="story"]'

test.describe(() => {
  test.skip(TARGET !== 'local', 'fixture manifest ids are only guaranteed to match the local fixtured server')

  test('the header search box runs a query and lists story rows', async ({ page }) => {
    const { search } = readManifest()

    await page.goto('/')

    await page.getByTestId('search-input').fill(search.query)
    await page.getByTestId('search-input').press('Enter')

    await expect(page).toHaveURL(/\/search\?/)
    // The heading, not the rows: the feed is still mounted while the search
    // loader is in flight.
    await expect(page.getByTestId('search-heading')).toContainText(search.query)
    // The box is the control that produced this page — it must show what
    // produced it, not go blank the moment the query lands in the URL.
    await expect(page.getByTestId('search-input')).toHaveValue(search.query)

    const rows = page.locator(story)
    await expect(rows.first()).toBeVisible()
    await expect(rows.locator('[data-testid="story-title"]')).toHaveCount(await rows.count())

    // A second search, then back: the box has to track navigation, not just
    // the initial load. The recorded empty query is a convenient second value
    // that is guaranteed to differ in outcome (no rows) from the first.
    await page.getByTestId('search-input').fill(search.emptyQuery)
    await page.getByTestId('search-input').press('Enter')
    await expect(page.getByTestId('search-empty')).toBeVisible()

    await page.goBack()
    await expect(page.getByTestId('search-heading')).toContainText(search.query)
    await expect(page.getByTestId('search-input')).toHaveValue(search.query)
  })

  test('a query with no hits says so instead of rendering an empty list', async ({ page }) => {
    const { search } = readManifest()

    await page.goto(`/search?q=${encodeURIComponent(search.emptyQuery)}`)
    await expect(page.getByTestId('search-empty')).toBeVisible()
    await expect(page.locator(story)).toHaveCount(0)
  })

  test('an author history filters to stories and to comments', async ({ page }) => {
    const { user } = readManifest()

    await page.goto(`/user/${user}`)
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
