import { expect, test, TARGET, siteFromPreviewHost } from './fixtures.js'

/**
 * Written before the UI it covers (`.claude/rules/testing.md`): the
 * `data-testid`s below are a contract the sign-in components are built
 * against, not a description of what they happened to render.
 *
 * | testid            | what it is                                              |
 * | ----------------- | -------------------------------------------------------- |
 * | `auth-signout`    | the "Sign out" button, present only when signed in        |
 * | `auth-user`       | the signed-in user's email; absent entirely when signed out |
 * | `auth-dev-name`   | the dev-login name input (local mode only)                |
 * | `auth-dev-login`  | the dev-login submit button (local mode only)              |
 *
 * There is no `auth-signin` testid any more: sign-in off local now happens
 * at the CloudFront edge, not in the app. A CloudFront Function checks the
 * `__Host-cdkcore-session` cookie on every request; an anonymous top-level
 * navigation gets a 302 to Cognito's hosted UI, and an anonymous subresource
 * request (one carrying a `sec-fetch-mode` other than `navigate`) gets a
 * 401. So off local there is no signed-out page to render a button on — the
 * app is only ever reached once a session cookie already exists.
 *
 * Three targets, from `TARGET` in `./fixtures.js`: `local`, `preview`,
 * `prod`. Every target-specific test is skipped at **declaration** scope
 * (`test.describe` + `test.skip(...)`), never with an in-body `test.skip`:
 * Playwright resolves a test's fixtures before running its body, so an
 * in-body skip comes too late — `machineAuth` would already have thrown on
 * `prod`. See `.claude/rules/auth.md`.
 */

// local only: signed out on a fresh page.
test.describe(() => {
  test.skip(TARGET !== 'local', 'the dev-login box only exists in local mode, which has no edge gate')

  test('a fresh local page shows the dev-login form and no signed-in user', async ({ page }) => {
    await page.goto('/')

    // The dev-login form is there...
    await expect(page.getByTestId('auth-dev-name')).toBeVisible()
    await expect(page.getByTestId('auth-dev-login')).toBeVisible()

    // ...and no one is signed in yet.
    await expect(page.getByTestId('auth-user')).toHaveCount(0)
  })
})

// local only: the dev-login round trip.
test.describe(() => {
  test.skip(TARGET !== 'local', 'the dev-login box only exists in local mode')

  test('dev login round-trips through localStorage, and sign-out clears it', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('auth-dev-name').fill('tyler')
    await page.getByTestId('auth-dev-login').click()
    await expect(page.getByTestId('auth-user')).toHaveText('tyler@local')

    // The round trip matters: this proves the token is read back from
    // localStorage and sent on the next request, not just held in React
    // state that a reload would lose.
    await page.reload()
    await expect(page.getByTestId('auth-user')).toHaveText('tyler@local')

    await page.getByTestId('auth-signout').click()
    await expect(page.getByTestId('auth-user')).toHaveCount(0)
  })
})

// local + preview: a machine-authed page reads back the signed-in user.
// Local runs this through `dev:claude` seeded into localStorage; preview
// exchanges a real machine token for the edge's session cookie first (see
// `authedPage` in `./fixtures.ts`). Prod is excluded because it has no
// machine identity by design.
test.describe(() => {
  test.skip(TARGET === 'prod', 'production has no machine identity by design')

  test('a machine-authed page reads back the signed-in user', async ({ authedPage }) => {
    await authedPage.goto('/')

    // Not asserting the exact email: the point is that the machine fixture
    // produces a session the app accepts, not what the pool named the user.
    const user = authedPage.getByTestId('auth-user')
    await expect(user).toBeVisible()
    await expect(user).toContainText('@')
  })
})

// preview only: a genuinely cookie-less browser context is bounced away
// from the site entirely. `browser.newContext()`, not the shared `page`
// fixture, because a context created off the ambient `page` may already
// carry a session cookie from another test in the same worker.
test.describe(() => {
  test.skip(TARGET !== 'preview', 'asserts the edge gate, which only exists off local')

  test('a fresh context with no session cookie is redirected off the preview host', async ({ browser, baseURL }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto('/')

      // Structural, not content-based (`.claude/rules/testing.md`): match on
      // host, never on hosted-UI page content, which belongs to Cognito and
      // Google and will change out from under this test.
      const landedHost = new URL(page.url()).host
      const previewHost = new URL(baseURL!).host
      expect(landedHost).not.toBe(previewHost)
      expect(/\.amazoncognito\.com$/.test(landedHost) || /(^|\.)google\.com$/.test(landedHost)).toBe(true)
    } finally {
      await context.close()
    }
  })
})

// prod only: an unauthenticated request is met with a 302 at the edge,
// before the request ever reaches the origin. This replaces the old
// "`/api/v1/me` returns 401" assertion — with the gate in front of
// everything, the origin is never involved in answering an anonymous
// top-level request.
test.describe(() => {
  test.skip(TARGET !== 'prod', 'asserts the edge gate against the real production host')

  test('an unauthenticated request to production is redirected to the hosted UI', async ({ request, baseURL }) => {
    const res = await request.get(baseURL!, { maxRedirects: 0 })

    expect(res.status()).toBe(302)
    const location = res.headers()['location'] ?? ''
    expect(/\.amazoncognito\.com/.test(location) || /(^|\.)google\.com/.test(location)).toBe(true)
  })
})

// preview only, targeting the *production* host directly: the assertion
// that actually proves the two Cognito pools are isolated. `/auth/*` is
// ungated, so this request reaches the origin; production's Lambda verifier
// is built for the production pool, so a preview-pool token must fail its
// `iss` check.
test.describe(() => {
  test.skip(TARGET !== 'preview', 'needs a preview machine token and a live production API')

  test('a preview machine token is rejected by the production /auth/session endpoint', async ({ machineAuth, request, baseURL }) => {
    const previewHost = new URL(baseURL!).host
    const prodHost = siteFromPreviewHost(previewHost)

    const res = await request.get(`https://${prodHost}/auth/session`, {
      headers: { 'x-id-token': machineAuth.idToken },
    })

    // The invariant is **not accepted**: a 2xx or anything but 401 here
    // would mean production's verifier trusted a token minted by the
    // preview pool, which is the only outcome that would actually be a bug.
    expect(res.status()).toBe(401)
  })
})
