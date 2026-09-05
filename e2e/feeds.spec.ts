import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The six feeds and their pagination.
 *
 * Written **before** the routes exist, so the `data-testid` set below is a
 * contract the components are built against rather than a description of
 * whatever they turned out to render. That is why Epoch 1's specs survived a
 * component rewrite untouched.
 *
 * Nothing here asserts a feed's length. `ask`, `show` and `job` were measured
 * at 55/137/31 ids and will not stay there; `pageCount` is computed from the
 * list as fetched, so the only safe assertion is that the page *agrees with
 * itself* — the status line's total matches whether Next is offered.
 */

const story = '[data-testid="story"]'

const feeds = [
  { label: 'new', path: '/newest' },
  { label: 'best', path: '/best' },
  { label: 'ask', path: '/ask' },
  { label: 'show', path: '/show' },
  { label: 'jobs', path: '/jobs' },
] as const

/** "Page 2 of 17" → [2, 17]. The status line is the page's own claim about itself. */
async function readStatus(page: Page): Promise<[number, number]> {
  const text = await page.getByTestId('page-status').innerText()
  const [current, total] = text.match(/\d+/g)!.map(Number)
  return [current!, total!]
}

test('the header links to every feed, and each one renders story rows', async ({ page }) => {
  await page.goto('/')

  // Epoch 1 rendered these as inert spans on purpose — a Link to a route that
  // does not exist is a type error. Routes came first; this asserts they are
  // links now.
  await expect(page.getByTestId('nav-link')).toHaveCount(feeds.length + 1)

  for (const feed of feeds) {
    await page.getByTestId('nav-link').filter({ hasText: feed.label }).click()
    await expect(page).toHaveURL(new RegExp(`${feed.path}$`))

    // Wait on the heading, not the rows: the router keeps the previous route
    // mounted while the loader is in flight, so the *old* feed's rows are
    // still in the DOM for a beat after the URL changes.
    await expect(page.getByTestId('feed-title')).toHaveText(new RegExp(feed.label, 'i'))

    const rows = page.locator(story)
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    // HN's page size, and the unit `?p=` counts in. A short feed's only page
    // has fewer; no page ever has more.
    expect(count).toBeLessThanOrEqual(30)

    await expect(rows.locator('[data-testid="story-title"]')).toHaveCount(count)
  }
})

test('pagination walks forward and back, and ranks keep counting', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  const [firstPage, pageCount] = await readStatus(page)
  expect(firstPage).toBe(1)
  expect(pageCount).toBeGreaterThan(1)

  // Page 1 has nowhere to go back to, and says so as a disabled control
  // rather than by omitting it — a control that appears and disappears
  // reflows the row it sits in.
  await expect(page.getByTestId('page-prev')).toHaveAttribute('data-disabled', '')

  await page.getByTestId('page-next').click()
  await expect(page).toHaveURL(/\?p=2$/)
  await expect(page.getByTestId('page-status')).toContainText('2')

  // Rank is absolute across the feed, not per page: page 2 starts at 31.
  await expect(page.locator(`${story} [data-testid="story-rank"]`).first()).toHaveText('31.')
  await expect(page.locator(story)).toHaveCount(30)

  await page.getByTestId('page-prev').click()
  await expect(page).toHaveURL(/\?p=1$/)
  await expect(page.locator(`${story} [data-testid="story-rank"]`).first()).toHaveText('1.')
})

test('the last page offers no next', async ({ page }) => {
  // `jobs` is the shortest feed (31 ids observed), so its last page is
  // reachable in one click instead of sixteen — but the assertion reads the
  // page count off the page rather than assuming what it is.
  await page.goto('/jobs')
  await expect(page.getByTestId('feed-title')).toBeVisible()

  const [, pageCount] = await readStatus(page)
  await page.goto(`/jobs?p=${pageCount}`)
  await expect(page.getByTestId('page-status')).toContainText(String(pageCount))
  await expect(page.getByTestId('page-next')).toHaveAttribute('data-disabled', '')
})
