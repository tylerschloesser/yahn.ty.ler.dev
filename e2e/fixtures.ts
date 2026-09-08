import { execFileSync } from 'node:child_process'
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

/**
 * Machine auth for the e2e suite.
 *
 * Three targets, not two — and the third is the interesting one:
 *
 * - **local** (`PLAYWRIGHT_BASE_URL` unset): no AWS at all. The backend runs
 *   with `AUTH=local`, which trusts the literal string `dev:<name>`.
 * - **preview** (`pr-<n>.preview.<site>`): a real Cognito pool is live, and a
 *   real token is minted for the per-site machine user with two AWS CLI calls.
 * - **prod** (anything else): **there is no machine identity, and there cannot
 *   be one.** The prod pool has no native users and its only client's
 *   `ExplicitAuthFlows` is refresh-only, so nothing this suite can do produces
 *   a prod token. Specs that need one skip against prod and assert the 401
 *   instead; the signed-in half of production is checked by a human doing a
 *   Google login.
 *
 * Everything target-specific lives here or in a `test.skip` keyed on `TARGET`,
 * never in a branch inside a test body (`.claude/rules/testing.md`).
 */

export type Target = 'local' | 'preview' | 'prod'

function detectTarget(): Target {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL
  if (!baseURL) return 'local'
  return /^pr-\d+\.preview\./.test(new URL(baseURL).host) ? 'preview' : 'prod'
}

export const TARGET = detectTarget()

export interface MachineIdentity {
  readonly idToken: string
  readonly accessToken: string
  readonly email: string
}

interface MachineUserSecret {
  readonly username: string
  readonly password: string
  readonly clientId: string
  readonly userPoolId: string
}

interface AuthenticationResult {
  readonly IdToken: string
  readonly AccessToken: string
}

/** `pr-<n>.preview.<site>` -> `<site>`. */
export function siteFromPreviewHost(host: string): string {
  const match = /^pr-\d+\.preview\.(.+)$/.exec(host)
  if (!match) throw new Error(`could not derive site from preview host: ${host}`)
  return match[1]!
}

function runAws(args: readonly string[]): string {
  try {
    // `env: process.env` passes AWS_PROFILE through when set (a session on a
    // laptop); CI instead has role credentials already in the environment,
    // and both work unchanged without hard-coding a profile.
    return execFileSync('aws', args, { env: process.env, encoding: 'utf8' })
  } catch (err) {
    // A fixture that silently yields no token turns an auth failure into a
    // confusing assertion failure ten lines later — surface the CLI's stderr.
    // Do not retry a failed `initiate-auth`: Cognito locks the user out after
    // 5 consecutive failures with a rising backoff, and the usual cause is a
    // stack update having rotated the password, so re-reading the secret
    // (i.e. a fresh run) is the fix, never a loop.
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : ''
    throw new Error(`aws ${args.join(' ')} failed: ${stderr || String(err)}`)
  }
}

async function fetchMachineIdentity(baseURL: string): Promise<MachineIdentity> {
  const host = new URL(baseURL).host
  const site = siteFromPreviewHost(host)

  const secretJson = runAws([
    'secretsmanager',
    'get-secret-value',
    '--region',
    'us-east-1',
    '--secret-id',
    `${site}/preview-machine-user`,
    '--query',
    'SecretString',
    '--output',
    'text',
  ])
  const secret = JSON.parse(secretJson) as MachineUserSecret

  // --no-sign-request is deliberate: InitiateAuth (USER_PASSWORD_AUTH) is an
  // unauthenticated Cognito API, so calling it unsigned means this fixture
  // needs no IAM permission for it at all.
  const authJson = runAws([
    'cognito-idp',
    'initiate-auth',
    '--region',
    'us-east-1',
    '--no-sign-request',
    '--auth-flow',
    'USER_PASSWORD_AUTH',
    '--client-id',
    secret.clientId,
    '--auth-parameters',
    `USERNAME=${secret.username},PASSWORD=${secret.password}`,
    '--query',
    'AuthenticationResult',
    '--output',
    'json',
  ])
  const auth = JSON.parse(authJson) as AuthenticationResult

  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    email: `${secret.username}@${site}`,
  }
}

// Test-scoped with a module-level memoised promise, not worker-scoped: a
// worker-scoped fixture's type parameter lives in a second generic bucket
// that then has to be threaded through every other fixture referencing it,
// and the only benefit here is one Cognito call per worker instead of per
// test. A module-level promise gets the same one-call-per-worker sharing
// (each worker is its own module instance) with none of that typing cost.
let identityPromise: Promise<MachineIdentity> | undefined

/** The memoised machine identity. Throws on `prod`, which has no machine user by design. */
function machineIdentity(): Promise<MachineIdentity> {
  if (TARGET === 'prod') {
    // Loud rather than empty: a fixture that quietly yielded a useless token
    // would turn this into a 401 twenty lines later.
    throw new Error('machineAuth: production has no machine user by design — skip on TARGET')
  }
  identityPromise ??=
    TARGET === 'preview'
      ? fetchMachineIdentity(process.env.PLAYWRIGHT_BASE_URL!)
      : Promise.resolve({ idToken: 'dev:claude', accessToken: 'dev:claude', email: 'claude@local' })
  return identityPromise
}

/**
 * Gives a browser context the edge session cookie, by exchanging the machine
 * ID token at the one ungated route.
 *
 * `context.request`, never `request.newContext()`: an `APIRequestContext`
 * obtained from a browser context shares that context's cookie jar, so the
 * `Set-Cookie` lands where the subsequent `page.goto()` will send it. A
 * standalone request context drops it, and the failure surfaces later as a
 * redirect loop rather than as anything naming the cause.
 */
async function installSession(context: BrowserContext): Promise<void> {
  const identity = await machineIdentity()
  const response = await context.request.get('/auth/session', {
    headers: { 'x-id-token': identity.idToken },
  })
  if (response.status() !== 204) {
    throw new Error(
      `installSession: GET /auth/session returned ${response.status()}, expected 204: ${await response.text()}`,
    )
  }
}

export const test = base.extend<{ machineAuth: MachineIdentity; authedPage: Page }>({
  /**
   * **Every** spec needs a session off local now, not just the auth ones: the
   * whole site is behind the edge gate, so a plain `page.goto('/')` against a
   * preview is answered with a 302 to Cognito and never reaches the app. So
   * the default `page` carries the machine session on `preview`.
   *
   * Not on `local` — there is no gate and no `/auth/session` there, and
   * `auth.spec.ts` needs a genuinely signed-out page to drive the dev-login
   * box. Not on `prod` either: it has no machine identity by design, so the
   * specs that need a session skip there rather than pretend.
   *
   * A spec that wants a *cookie-less* context on preview must build one with
   * `browser.newContext()`, which this does not touch.
   */
  page: async ({ page }, use) => {
    if (TARGET === 'preview') await installSession(page.context())
    await use(page)
  },

  // Playwright parses this signature at runtime to know which fixtures a
  // fixture depends on, so the first parameter must be a literal `{}` even
  // though this one depends on nothing.
  // oxlint-disable-next-line no-empty-pattern
  machineAuth: async ({}, use) => {
    await use(await machineIdentity())
  },

  /**
   * A page with a signed-in user, on every target.
   *
   * On `preview` the `page` fixture above has already installed the edge
   * session, so this only has to add the one thing that differs: `local` has
   * no gate and no `/auth/session`, so there a session is `localStorage`
   * seeded before the first navigation, exactly as it was before the gate.
   */
  authedPage: async ({ page, machineAuth }, use) => {
    if (TARGET === 'local') {
      await page.addInitScript(
        ({ storageKey, idToken, accessToken }) => {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({
              idToken,
              accessToken,
              // An hour out: long enough that no test's run time gets near the
              // 5-minute refresh window baked into getToken().
              expiresAt: Date.now() + 60 * 60 * 1000,
            }),
          )
        },
        { storageKey: 'cdkcore:auth', idToken: machineAuth.idToken, accessToken: machineAuth.accessToken },
      )
    }
    await use(page)
  },
})

export { expect }
