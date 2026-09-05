import { expect, test } from '@playwright/test'

/**
 * The vertical slice, asserted structurally.
 *
 * These run against live Hacker News — locally via the `webServer` in
 * `playwright.config.ts`, or against a deployed preview when
 * `PLAYWRIGHT_BASE_URL` is set. The front page changes under the test, so
 * nothing here asserts *what* a story says: only that a feed of story rows
 * renders, that each row carries the parts HN's own layout has, and that
 * clicking through yields a real comment tree.
 *
 * Content is used to *choose* what to click (the busiest thread, so the tree
 * assertions have something to find) and never to assert.
 */

const story = '[data-testid="story"]'

test('the front page renders a feed of story rows', async ({ page }) => {
  await page.goto('/')

  const rows = page.locator(story)
  await expect(rows.first()).toBeVisible()
  // HN's page size, and the unit `?p=` counts in.
  await expect(rows).toHaveCount(30)

  // Every row is a link to something and a link to its discussion. Score is
  // deliberately not required of every row: `topstories` also contains job
  // posts, which HN ranks without a visible score.
  await expect(rows.locator('[data-testid="story-title"]')).toHaveCount(30)
  await expect(rows.locator('[data-testid="story-comments"]')).toHaveCount(30)
  expect(await rows.locator('[data-testid="story-score"]').count()).toBeGreaterThan(20)
})

test('a story opens a nested comment tree', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  // Pick the busiest thread on the page, so "renders a tree" is actually
  // testable rather than dependent on whatever happens to be at rank 1.
  const counts = await page.locator(`${story} [data-testid="story-comments"]`).allInnerTexts()
  const busiest = counts
    .map((text, index) => ({ index, n: Number(text.replace(/\D+/g, '') || 0) }))
    .sort((a, b) => b.n - a.n)[0]
  expect(busiest?.n).toBeGreaterThan(0)

  await page.locator(`${story} [data-testid="story-comments"]`).nth(busiest!.index).click()

  await expect(page).toHaveURL(/\/item\/\d+$/)

  // Wait on the comment tree, not the title: the router keeps the previous
  // route mounted while the loader is in flight, so the URL changes a beat
  // before the feed stops being what is on screen.
  const comments = page.locator('[data-testid="comment"]')
  await expect(comments.first()).toBeVisible()

  // One story title, not thirty — proof the feed really is gone.
  await expect(page.locator('[data-testid="story-title"]')).toHaveCount(1)

  // The tree, not a flat list: at least one comment nested inside another.
  // The busiest thread on HN's front page always has replies.
  await expect(page.locator('[data-testid="comment"] [data-testid="comment"]').first()).toBeVisible()
})
