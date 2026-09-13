import { expect, test } from '../fixtures.js'

/**
 * The live-HN canary (`.claude/rules/testing.md`, PRE-PLAN D8): structural
 * only, against real Hacker News, excluded from the default `chromium`
 * project and run manually or on a schedule via `pnpm e2e:live`. A cold live
 * thread is hundreds of Firebase requests, so this is deliberately not part
 * of the one-minute default-suite budget.
 *
 * Nothing here asserts *what* HN says: only that the six feeds render rows
 * shaped like stories, that the busiest thread on the front page opens and
 * its top comment collapses, that a byline opens a real user page, and that
 * a common one-word query returns rows. Content is used only to *choose*
 * what to click.
 */

const story = '[data-testid="story"]'
const comment = '[data-testid="comment"]'

const feeds = ['/', '/newest', '/best', '/ask', '/show', '/jobs'] as const

test('all six feeds render story rows', async ({ page }) => {
  for (const path of feeds) {
    await page.goto(path)
    const rows = page.locator(story)
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBeGreaterThan(0)
  }
})

test('the busiest thread on the front page opens and its top comment collapses', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  const counts = await page.locator(`${story} [data-testid="story-comments"]`).allInnerTexts()
  const busiest = counts
    .map((text, index) => ({ index, n: Number(text.replace(/\D+/g, '') || 0) }))
    .sort((a, b) => b.n - a.n)[0]
  expect(busiest?.n).toBeGreaterThan(0)

  await page.locator(`${story} [data-testid="story-comments"]`).nth(busiest!.index).click()
  await expect(page).toHaveURL(/\/item\/\d+$/)
  await expect(page.locator(comment).first()).toBeVisible()

  const id = await page
    .locator(comment)
    .filter({ has: page.locator(comment) })
    .first()
    .getAttribute('data-comment-id')
  expect(id).toBeTruthy()

  const parent = page.locator(`[data-comment-id="${id}"]`)
  const toggle = parent.getByTestId('comment-toggle').first()
  const firstReply = parent.locator(comment).first()

  await expect(firstReply).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(firstReply).toBeHidden()
})

test('a byline opens a real user page', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  await page.locator(`${story} [data-testid="story-author"]`).first().click()
  await expect(page).toHaveURL(/\/user\/.+$/)
  await expect(page.getByTestId('user-karma')).toBeVisible()
})

test('a common search query returns story rows', async ({ page }) => {
  await page.goto('/')

  // A one-word, high-frequency query against all of live HN always has hits;
  // the word itself is never asserted on, only that rows came back.
  await page.getByTestId('search-input').fill('the')
  await page.getByTestId('search-input').press('Enter')

  await expect(page).toHaveURL(/\/search\?/)
  const rows = page.locator(story)
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
})
