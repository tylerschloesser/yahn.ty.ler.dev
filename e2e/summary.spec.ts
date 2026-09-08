import { expect, test } from './fixtures.js'
import type { Page } from '@playwright/test'

/**
 * `ThreadSummary` streams `GET /events/v1/enrich/thread/:id` and renders the
 * markdown as it arrives. Assertions are structural only: the summary text
 * comes from a model (the `fake` provider locally and in CI, a real one on a
 * deployed preview) and differs every run, so nothing here checks content —
 * only that the states the contract promises actually happen.
 *
 * Written before the component, per `.claude/rules/testing.md`: the
 * `data-testid`s and the `data-state` values below are the contract the
 * component is built against, not a description of what it happened to
 * render.
 */

const summary = '[data-testid="thread-summary"]'
const requestButton = '[data-testid="thread-summary-request"]'
const summaryText = '[data-testid="thread-summary-text"]'
const errorMessage = '[data-testid="thread-summary-error"]'

/** Any thread will do — the summary region doesn't care which story it's on. */
async function openAnyThread(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('[data-testid="story"]').first()).toBeVisible()
  await page.locator('[data-testid="story-comments"]').first().click()
  await expect(page).toHaveURL(/\/item\/\d+$/)
  await expect(page.locator(summary)).toBeVisible()
}

test('a summary is not requested automatically', async ({ page }) => {
  await openAnyThread(page)

  // The whole point of the button: a summary costs real money per thread, so
  // nothing streams until a reader asks for it.
  await expect(page.locator(requestButton)).toBeVisible()
  await expect(page.locator(summaryText)).toHaveCount(0)
  await expect(page.locator(errorMessage)).toHaveCount(0)
})

test('requesting a summary reaches a completed state with no error', async ({ page }) => {
  await openAnyThread(page)

  await page.locator(requestButton).click()

  // The request button only exists before a stream has started.
  await expect(page.locator(requestButton)).toHaveCount(0)

  // A stream that never reaches `complete` or `error` is a failure per the
  // contract, so "completed" is the only state this waits on — there is no
  // other terminal state that counts as success.
  await expect(page.locator(summary)).toHaveAttribute('data-state', 'complete', { timeout: 30_000 })

  await expect(page.locator(summaryText)).toBeVisible()
  const content = await page.locator(summaryText).innerText()
  expect(content.trim().length).toBeGreaterThan(0)

  await expect(page.locator(errorMessage)).toHaveCount(0)
})

test('navigating away mid-stream leaves no error behind', async ({ page }) => {
  await openAnyThread(page)

  await page.locator(requestButton).click()
  await expect(page.locator(requestButton)).toHaveCount(0)

  // Leave immediately, before the stream can finish. This exercises cleanup
  // on unmount (the fetch is aborted) rather than any particular UI state.
  await page.goto('/')
  await expect(page.locator('[data-testid="story"]').first()).toBeVisible()
})
