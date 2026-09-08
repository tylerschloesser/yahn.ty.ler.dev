---
paths:
  - "apps/api/src/auth.ts"
  - "apps/web/src/components/AuthMenu/**"
  - "e2e/fixtures.ts"
  - "scripts/preview-login.sh"
---

# Google sign-in: two pools, one Google client, and a machine user

Loaded when you touch the auth seam, the sign-in control, the e2e fixture or the login script.

**The whole site is behind Google auth at the CloudFront edge.** A stranger cannot load the
app, an asset or `__config.json` — a request with no valid session cookie never reaches an
origin. That is `auth: { gate: 'edge' }` in `infra/cdk/bin/app.ts`, and the mechanism is
cdk-core's `.claude/rules/edge-gate.md`. **There is no allowlist: anyone with a Google account
gets the whole app.** That is deliberate, not an oversight.

**Almost none of this is yahn's code.** `@tylerschloesser/cdk-core` ships the pools, the browser
PKCE flow, the server verifier, the preview bounce host and the machine user; yahn wires them
into four places. **The authoritative description of the mechanism is that package's own
`.claude/rules/auth.md` and its `preview-auth` skill** (`/Users/tyler/repos/cdk-core`) — read
those before changing behavior, not this file. What is below is only what is true *here*.

## The shape

| | prod | preview |
| --- | --- | --- |
| pool | `YahnSite` | `YahnPreview`, one pool shared by every open PR |
| hosted UI | `yahn-ty-ler-dev.auth.us-east-1.amazoncognito.com` | `yahn-ty-ler-dev-preview.auth.…` |
| browser callback | `https://yahn.ty.ler.dev/auth/callback` | `https://oauth.preview.yahn.ty.ler.dev/` |
| other clients | none | `machine` (password flow, no hosted UI) |
| native users | **none** | `claude`, password in Secrets Manager |

The two pools exist to be **isolated, not merely separate**: a token's `iss` is its pool, so a
preview token sent to `https://yahn.ty.ler.dev/api/v1/me` is a 401 no flag can turn into a 200.
`e2e/auth.spec.ts` asserts exactly that, and it — not the happy-path 200 — is the test worth
having.

- **The two `domainPrefix` values are written out in `infra/cdk/bin/app.ts` rather than
  defaulted, because they also exist in Google's console.** Both pools trust the *same* Google
  OAuth client (secret `cdk-core/google-oauth`, shared with every other cdk-core site), whose
  authorized redirect URIs must include both hosted-UI domains' `/oauth2/idpresponse`. There is
  no API for this — onboarding a site is a human adding two URIs. A mismatch is
  `redirect_uri_mismatch` **at Google, with nothing in any AWS log**, so check the pair before
  touching a browser:
  ```
  curl -sS -L --max-time 15 -o /tmp/authcheck.html \
    "https://yahn-ty-ler-dev-preview.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=<browser client id>&response_type=code&scope=openid+email+profile&redirect_uri=https%3A%2F%2Foauth.preview.yahn.ty.ler.dev%2F&identity_provider=Google"
  grep -o "Error 400\|redirect_uri_mismatch\|Sign in" /tmp/authcheck.html
  ```
  A working pair lands on a Google sign-in page: `Sign in` present, no `Error 400`.
- **A preview's `redirect_uri` is the bounce host `oauth.preview.yahn.ty.ler.dev`, not the PR's
  own hostname**, because Cognito's callback list has no wildcards. The router turns the `pr`
  digits in `state` back into `pr-<n>.preview.yahn.ty.ler.dev`. The host needs **no DNS work
  here** — the existing `*.preview.yahn.ty.ler.dev` A/AAAA records and the certificate's SAN
  already cover it.

## `x-id-token`, never `Authorization`

CloudFront's origin access control signs the origin request with SigV4 and writes its own
`Authorization` header before the Lambda sees it, so a viewer-supplied bearer token there is
overwritten. Every call carries the ID token — never the access token, whose only scope is
`aws.cognito.signin.user.admin` — in `x-id-token`.

- On the server, `getAuthUser(c)` in `apps/api/src/auth.ts` is **the only place the API learns
  who is calling**, and a middleware puts the result on the Hono context. A handler that reads a
  header itself is the thing that makes the next epoch expensive.
- On the client, `apiFetch` from `@tylerschloesser/cdk-core/auth/browser` is **the only thing
  that calls `/api` or `/events`** — never a bare `fetch`. That is where the header is attached,
  which is why no component ever handles a token.

## The three `AUTH` modes

Read per call, never at module load. `cognito` (the CDK sets it, with `AUTH_ISSUER` and
`AUTH_CLIENT_ID`), `local` (`applyLocalDefaults()` sets it, and only `pnpm dev` calls that), and
unset = `none`, where `getUser` returns `null` for everyone.

- **`local` trusts any `x-id-token` starting with `dev:`** — no signature, no expiry, no network,
  yielding `{ sub: 'dev:<name>', email: '<name>@local' }`. It is what keeps `pnpm dev`,
  `pnpm verify` and `pnpm e2e` credential-free. The constructs never emit it.
- **`none` is why the API was safe to merge before the pools existed.** Unset `AUTH` means
  `/api/v1/me` answers 401 for everyone and nothing else changes.
- **A preview's `AUTH_CLIENT_ID` is a comma-separated pair.** A token's `aud` is the app client
  that minted it, so a human's browser login and the machine user's `initiate-auth` produce
  different `aud`s in the same pool. Trusting both weakens nothing; `iss` is the boundary.

## The machine user, and the lockout

`YahnPreview` creates a `claude` native user whose generated password lives in Secrets Manager at
`yahn.ty.ler.dev/preview-machine-user` (JSON `{username, password, clientId, userPoolId}`). That
is what lets CI and a Claude session sign into a preview with no browser and no Google account.

**Both now take a third step, and it is not optional.** With the gate in front of everything, a
raw `x-id-token` header is refused at the *edge* before it reaches the Lambda — only `/auth/*` is
ungated. So the ID token has to be exchanged for a session cookie first:

- `scripts/preview-login.sh <pr>` reads the secret, calls `initiate-auth`, then
  `GET /auth/session` with the token, and prints **the path to a cookie jar** on stdout — not the
  token. Use it as `curl -b "$(scripts/preview-login.sh 12)" https://pr-12.preview.…/`.
  **`<pr>` is now required**: a `__Host-` cookie is host-only by spec, so a session has to be
  minted against one specific preview host, even though the two AWS calls behind it are identical
  for every PR of a site.
- `e2e/fixtures.ts` makes the same two AWS calls and then the same exchange, through
  `page.context().request` so the cookie lands in the browser context's jar.

`InitiateAuth` is an **unauthenticated** Cognito API, so both call it `--no-sign-request` and need
no IAM permission for it; the only permission on this path is `secretsmanager:GetSecretValue` on
that one secret, which `YahnGithubOidc` already grants.

- **Cognito locks the user out after 5 consecutive failed password attempts, with a rising
  backoff. Do not retry a failed `initiate-auth` — re-read the secret.** The usual cause is a
  stack update having rotated the generated password, and the secret always has the current one;
  a retry loop only extends the lockout.
- **Never pipe a Cognito ID token through `xargs -I{}`.** That form truncates a replacement line
  at 255 bytes and an ID token is ~1050, so every call 401s with no clue why. `preview-login.sh`
  no longer prints a token, so its own output is safe — but the trap is still live any time you
  handle the raw token yourself, which is what `initiate-auth` hands you.
- **Production has no machine identity, by design.** Its only app client's `ExplicitAuthFlows` is
  exactly `["ALLOW_REFRESH_TOKEN_AUTH"]` — there is no password flow to call and no flag to flip,
  and the pool has no native users. So nothing automated can check the signed-in half of prod;
  that is a human doing a real Google login, and `e2e/auth.spec.ts` skips those cases on `prod`
  rather than pretending otherwise.

## The browser holds a cookie, not a token

Deployed, the credential is an `HttpOnly` cookie the page cannot read, set by the edge gate's
`/auth/*` Lambda. The SPA does not start a login and does not handle a callback — that code is
gone, along with `apps/web/src/routes/auth.callback.tsx`. `AuthMenu` shows the signed-in email,
and "Sign out" is a **navigation to `/auth/logout`**, because JavaScript cannot clear an
`HttpOnly` cookie.

`localStorage['cdkcore:auth']` (`{idToken, accessToken, refreshToken?, expiresAt}`) survives for
exactly one caller: **`pnpm dev`**, which has no CloudFront and therefore no gate. The dev-login
box writes it and `AUTH=local` trusts it. `e2e/fixtures.ts` still seeds it with
`page.addInitScript` on the local target — and cannot on a deployed one, because a gated
navigation never reaches a page to run an init script in. There the fixture calls
`GET /auth/session` with `x-id-token` through `page.context().request`, whose cookie jar the
browser context shares.

`apiFetch` stays and still attaches `x-id-token`. Deployed, that header is usually empty and
the cookie is what authenticates; the header path is how a *machine* caller signs in. Both
reach the same `getAuthUser(c)`.
