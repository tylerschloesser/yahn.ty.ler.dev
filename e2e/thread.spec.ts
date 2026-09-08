import { expect, test } from './fixtures.js'
import type { Page } from '@playwright/test'

/**
 * Thread-level behaviour: collapsing a subtree, and HN's own URL shape.
 *
 * The thread is chosen by content (the busiest one on the front page) and
 * asserted structurally — picking is not asserting. A fixed item id would be
 * the tempting alternative and is the wrong one: it would pass forever without
 * proving that today's HN still renders.
 */

const story = '[data-testid="story"]'
const comment = '[data-testid="comment"]'

/** Opens the busiest thread on the front page, so there is a subtree to collapse. */
async function openBusiestThread(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator(story).first()).toBeVisible()

  const counts = await page.locator(`${story} [data-testid="story-comments"]`).allInnerTexts()
  const busiest = counts
    .map((text, index) => ({ index, n: Number(text.replace(/\D+/g, '') || 0) }))
    .sort((a, b) => b.n - a.n)[0]
  expect(busiest?.n).toBeGreaterThan(0)

  await page.locator(`${story} [data-testid="story-comments"]`).nth(busiest!.index).click()
  await expect(page.locator(comment).first()).toBeVisible()
}

test('collapsing a comment hides its replies and keeps its own header', async ({ page }) => {
  await openBusiestThread(page)

  // A comment that actually has replies — collapsing a leaf proves nothing.
  // Resolved to a *fixed* selector via its id rather than kept as the filtered
  // locator: the filter is "has a nested comment", which stops matching the
  // moment the collapse works, so the locator would silently re-resolve to a
  // different comment mid-test.
  const id = await page
    .locator(comment)
    .filter({ has: page.locator(comment) })
    .first()
    .getAttribute('data-comment-id')
  expect(id).toBeTruthy()

  const parent = page.locator(`[data-comment-id="${id}"]`)
  // The parent's own toggle is the first in its subtree: it sits in the meta
  // line, which precedes the replies in DOM order.
  const toggle = parent.getByTestId('comment-toggle').first()
  const firstReply = parent.locator(comment).first()

  await expect(firstReply).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await toggle.click()
  // `aria-expanded` rather than a styling hook: whether the replies are gone
  // or merely hidden is an implementation detail, but the button's announced
  // state is a contract.
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(firstReply).toBeHidden()
  // The comment does not vanish — its header stays, which is what makes the
  // toggle findable again.
  await expect(toggle).toBeVisible()

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(firstReply).toBeVisible()
})

test("HN's own item URL redirects to this app's", async ({ page }) => {
  await openBusiestThread(page)
  const id = new URL(page.url()).pathname.split('/').pop()!

  await page.goto(`/item?id=${id}`)
  await expect(page).toHaveURL(new RegExp(`/item/${id}$`))
  await expect(page.locator(comment).first()).toBeVisible()
})

test('a comment byline links to its author', async ({ page }) => {
  await openBusiestThread(page)

  await page.locator(`${comment} [data-testid="comment-author"]`).first().click()
  await expect(page).toHaveURL(/\/user\/.+$/)
  await expect(page.getByTestId('user-karma')).toBeVisible()
})
