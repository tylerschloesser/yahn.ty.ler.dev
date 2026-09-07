import { expect, test, TARGET } from './fixtures.js'

/**
 * Written before the UI it covers (`.claude/rules/testing.md`): the
 * `data-testid`s below are a contract the sign-in components are built
 * against, not a description of what they happened to render.
 *
 * | testid            | what it is                                              |
 * | ----------------- | -------------------------------------------------------- |
 * | `auth-signin`     | the "Sign in with Google" button (prod/preview only)      |
 * | `auth-signout`    | the "Sign out" button, present only when signed in        |
 * | `auth-user`       | the signed-in user's email; absent entirely when signed out |
 * | `auth-dev-name`   | the dev-login name input (local mode only)                |
 * | `auth-dev-login`  | the dev-login submit button (local mode only)              |
 *
 * Three targets, from `TARGET` in `./fixtures.js`: `local`, `preview`, `prod`.
 * Every target-specific test is skipped at **declaration** scope
 * (`test.describe` + `test.skip(...)`), never with an in-body `test.skip`:
 * Playwright resolves a test's fixtures before running its body, so an
 * in-body skip comes too late — `machineAuth` would already have thrown on
 * `prod`. See `.claude/rules/auth.md`.
 */

// local only: signed out on a fresh page.
test.describe(() => {
  test.skip(TARGET !== 'local', 'the dev-login box only exists in local mode')

  test('a fresh local page shows the dev-login form and no signed-in user', async ({ page }) => {
    await page.goto('/')

    // The dev-login form is there...
    await expect(page.getByTestId('auth-dev-name')).toBeVisible()
    await expect(page.getByTestId('auth-dev-login')).toBeVisible()

    // ...there is no Google to sign in to locally...
    await expect(page.getByTestId('auth-signin')).toHaveCount(0)

    // ...and no one is signed in yet.
    await expect(page.getByTestId('auth-user')).toHaveCount(0)
  })
})

// prod and preview: signed out on a fresh page.
test.describe(() => {
  test.skip(TARGET === 'local', 'this asserts the hosted-UI sign-in path, which only exists off local')

  test('a fresh page off local shows Google sign-in and no dev-login form', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('auth-signin')).toBeVisible()
    await expect(page.getByTestId('auth-user')).toHaveCount(0)

    // A `dev:` token would not be trusted by a backend running `AUTH=cognito`,
    // so offering the box here would be a lie.
    await expect(page.getByTestId('auth-dev-name')).toHaveCount(0)
    await expect(page.getByTestId('auth-dev-login')).toHaveCount(0)
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

// preview only: a machine-authed page reads back the signed-in user with no
// browser login at all. Local runs the identical shape through `dev:claude`
// and is already covered above; prod is skipped because it has no machine
// user by design.
test.describe(() => {
  test.skip(TARGET !== 'preview', 'needs a real Cognito machine token')

  test('a machine-authed page reads back the signed-in user', async ({ authedPage }) => {
    await authedPage.goto('/')

    // Not asserting the exact email: the point is that the machine fixture
    // produces a session the app accepts, not what the pool named the user.
    const user = authedPage.getByTestId('auth-user')
    await expect(user).toBeVisible()
    await expect(user).toContainText('@')
  })
})

// preview only, and this is the one worth having: a preview token sent to
// *production* must be rejected. `request`, not `page`, so the call never
// goes through the preview's own origin. This — not the 200 above — is what
// proves the two pools are isolated rather than merely separate: prod's
// verifier trusts a different `iss`, so no flag or config anywhere makes a
// preview token work there.
test.describe(() => {
  test.skip(TARGET !== 'preview', 'needs a preview token and a live production API')

  test('a preview token is rejected by production', async ({ machineAuth, request }) => {
    const res = await request.get('https://yahn.ty.ler.dev/api/v1/me', {
      headers: { 'x-id-token': machineAuth.idToken },
    })
    expect(res.status()).toBe(401)
  })
})
