import type { Context } from 'hono'

/**
 * The single place this API learns who is calling. It returns `null` today,
 * and every route is public and unauthenticated — there is no auth, no writes
 * and no per-user state in this epoch.
 *
 * It exists anyway because it is the seam. When Cognito's Google IdP lands,
 * per-user reading history and cached enrichments are partitioned by whatever
 * this returns, and wiring real auth up is a change to this function and
 * nothing else. A route that reaches for a header itself would be the thing
 * that makes that change expensive.
 *
 * The body becomes roughly:
 *
 *   const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'id', clientId })
 *   const payload = await verifier.verify(c.req.header('x-id-token') ?? '')
 *   return payload.sub
 *
 * The token travels in `x-id-token`, not `Authorization`: CloudFront's origin
 * access control signs the origin request with SigV4 and writes its own
 * `Authorization` header, so a viewer-supplied one is overwritten before the
 * Lambda ever sees it.
 */
export function getUserId(_c: Context): string | null {
  return null
}
