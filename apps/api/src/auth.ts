import type { Context } from 'hono'
import { getUser, type AuthUser } from '@tylerschloesser/cdk-core/auth/server'

export type { AuthUser }

/**
 * The single place this API learns who is calling. No handler ever reads a
 * header itself — that is what keeps this cheap to change later.
 *
 * The token travels in `x-id-token`, never `Authorization`: CloudFront's
 * origin access control signs the origin request with SigV4 and overwrites
 * `Authorization` before the Lambda ever sees it.
 *
 * The mode comes from the `AUTH` env var: `cognito` (set by the CDK) verifies
 * a real Cognito ID token, `local` (set by `applyLocalDefaults()`) trusts any
 * `x-id-token` starting with `dev:`, and unset means `none` — always `null`.
 */
export async function getAuthUser(c: Context): Promise<AuthUser | null> {
  return getUser(c)
}
