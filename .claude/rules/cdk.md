---
paths:
  - "infra/cdk/**"
  - ".github/workflows/**"
---

# infra/cdk and the workflows that drive it

Everything is in **us-east-1** (CloudFront requires its ACM certificate there) in account
`063257577013`. The `admin` profile has **no default region**, so `env` is explicit in
`bin/app.ts` and every CLI call needs `--region us-east-1`. Local access is SSO:
`aws sso login --profile admin`, then prefix with `AWS_PROFILE=admin`.

> **The account hosts thai.ler.dev's live production stacks** (`ThaiLerDevSiteStack`,
> `ThaiLerDevGithubOidcStack`), plus four unrelated ones. Never `destroy` or `delete-stack` a
> name you have not just read back from `aws cloudformation list-stacks`.

## The three stacks, and why three

| Stack | Deployed by | Holds |
| --- | --- | --- |
| `YahnGithubOidcStack` | **you, locally, once** | the `yahn-ty-ler-dev-github-deploy` role |
| `YahnSharedStack` | `deploy.yml` (and you) | one wildcard certificate |
| `YahnAppStack-{prod,pr-N}` | `deploy.yml` / `pr-preview.yml` | bucket, Lambda, CloudFront, DNS |

- **`YahnGithubOidcStack` never deploys from CI** — it grants CI the trust CI would need to
  deploy it. `deploy.yml` deliberately omits it, and a grep in that file is the acceptance
  check that it stays omitted.
- **It imports the OIDC provider, never creates one.** One provider per issuer per account, and
  `ThaiLerDevGithubOidcStack` already made it. `new iam.OpenIdConnectProvider(...)` here is the
  single most likely first-deploy failure.
- Its trust carries **four** `sub` values: the legacy and immutable forms of both
  `ref:refs/heads/main` and `pull_request`. Which form GitHub emits is a property of the repo,
  not of the policy, so both stay. The role's only permission is `sts:AssumeRole` on the CDK
  bootstrap roles, which is why it needs no revision when a stack grows a resource.
- **`YahnSharedStack` exists so previews never wait on certificate issuance.** That is the whole
  point; it took 160s to issue, and a preview is supposed to be ~5 minutes end to end.
- **The certificate ARN is hard-coded in `bin/app.ts`.** An `Fn::ImportValue` would couple every
  preview to the shared stack and block deleting a preview while the export is in use; SSM would
  put an untested dynamic reference inside CloudFront's `ViewerCertificate`. Recreating the
  certificate is a one-line edit either way. `bin/app.ts` says this at the constant.
- **Preview stacks are selected by CDK context**: `cdk deploy YahnAppStack-pr-7 -c pr=7`. Without
  `-c pr=`, `cdk list` shows exactly the three permanent stacks. `bin/app.ts` rejects a
  non-numeric `pr`, so the stack name cannot be forged from a context value.

## Conventions

- ESM + `nodenext`: **relative imports here carry `.js` extensions** even though the sources are
  `.ts`, because the app runs through `tsx`. This is the **one** package in the repo that does;
  every other uses `.ts`. See `.claude/rules/typescript-config.md`.
- `AppStack` reads `apps/web/dist` and throws if it is missing, so **`pnpm build` runs before any
  `synth`, `deploy` or `destroy`** — including `pr-teardown.yml`'s destroy, which synthesizes the
  app like any other CDK command.
- `esbuild` is a **root** devDependency, not this package's: `NodejsFunction` runs the bundler
  from the workspace root where the lockfile is. Without it CDK silently falls back to Docker.
  The root `package.json` records this in a `"//"` key — don't drop it in a manifest rewrite.
- `apps/api/src/lambda.ts` imports `@yahn/hn` and `@yahn/schema` as workspace **source** through
  their `exports` maps. esbuild must bundle them: never add them to `externalModules`. No
  `depsLockFilePath` — `NodejsFunction` walks up and finds the root lockfile on its own.

## Four CloudFront gotchas, each of which cost thai.ler.dev a debugging session

1. **`lambda:InvokeFunction` must be granted alongside `lambda:InvokeFunctionUrl`.** Lambda began
   requiring both on function URLs around Oct 2025; CDK's `withOriginAccessControl` still grants
   only the latter (aws/aws-cdk#35872), so `app-stack.ts` adds the second explicitly. Symptom:
   every request 403s and **nothing appears in the function's logs**, because the auth layer
   rejects it before invocation.
2. **The origin request policy must exclude `host` and only `host`**
   (`ALL_VIEWER_EXCEPT_HOST_HEADER`). The deny list applies to the *outbound* headers, which by
   then include the `Authorization` header OAC just added — denying `authorization` strips
   CloudFront's own signature. (This is also why a future viewer token travels in `x-id-token`.)
3. **SPA fallback is a CloudFront Function on the default behavior**, not distribution-wide
   `errorResponses`. Custom error responses apply to *every* behavior, so a 404 from `/api/*`
   would come back as the HTML shell with status 200. The function only rewrites URIs containing
   no `.`, so a genuinely missing asset still 404s.
4. **The API lives inside the app stack, not its own.** `FunctionUrlOrigin.withOriginAccessControl`
   adds a resource policy scoped to the distribution's ARN, so splitting them is a cycle.

thai's fifth gotcha — POST bodies needing `x-amz-content-sha256` under OAC SigV4 — does not apply
while this API is GET-only (`ALLOW_GET_HEAD_OPTIONS`). It will the moment `/api/v1/enrich/**`
exists.

## Caching — the deliberate divergence from thai

thai's `/api/*` is `CACHING_DISABLED`, correct for a per-user sync API and wrong here. Ours has a
custom policy: `minTtl 0 / defaultTtl 0 / maxTtl 300s`, query strings `all`, no headers, no
cookies, brotli + gzip. **`defaultTtl: 0` is what makes CloudFront honor the origin's own
`Cache-Control`** rather than override it, and `maxTtl` is the ceiling on an origin that
misbehaves. The origin is the authority: feeds send `max-age=30, stale-while-revalidate=300`,
items `max-age=60`, and **every non-2xx sends `no-store`** — see `.claude/rules/api.md`. That
last one is load-bearing: without it an HN blip would pin at every edge for 30s and serve stale
for 300 more.

Two `BucketDeployment`s, and the asymmetry is not optional: assets deploy `prune: true`, then
HTML `prune: false` with an explicit `addDependency`. `prune: true` on the second would delete
every hashed asset the first just uploaded. `UNVERSIONED` is just `*.html` — there is no service
worker here, which is also why nothing goes in `apps/web/public/` that might be edited in place.

## The preview lifecycle

`pr-preview.yml` (open/synchronize/reopen) → `pr-teardown.yml` (close) → `cleanup.yml` (daily).

- **`cancel-in-progress: false` on `pr-preview.yml` is load-bearing.** Cancelling the job does
  not cancel the CloudFormation deploy it started; the next push would then find the stack in
  `UPDATE_IN_PROGRESS` and fail. `pr-teardown.yml` shares the *same* concurrency group so a
  teardown can never race a deploy for the same PR. Only `ci.yml` cancels — it leaves nothing
  behind server-side.
- **Both deploy paths poll `/api/health` before Playwright.** CloudFormation reports the stack
  complete before the new record has propagated, and Playwright burns all its retries on
  NXDOMAIN in about two seconds.
- **`cleanup.yml` is the only scheduled thing that deletes, and it has two independent guards**:
  the `YahnAppStack-pr-` prefix filter and an anchored `^[0-9]+$` on what follows it. Together
  they reject `YahnAppStack-prod` (no trailing hyphen) *and* `YahnAppStack-pr-x`. **Neither may
  be loosened**, and a change to either is re-validated against `aws cloudformation list-stacks`
  before it merges. It uses raw `delete-stack` rather than CDK: the list comes from AWS, not from
  the app, and the stack's own `autoDeleteObjects` custom resource runs either way.
- Fork PRs get no preview, and that is correct: GitHub will not grant `id-token: write` to a fork
  PR, so the deploy could not authenticate. Both PR workflows carry the same explicit guard.

## claude.yml

thai's file, on node 24: the Claude Code GitHub Action in interactive mode on `@claude` mentions,
authenticating with the `CLAUDE_CODE_OAUTH_TOKEN` repository secret (a subscription token from
`claude setup-token`, chosen over an API key because the account's API key carries no credit).
The Claude GitHub App must be installed on the repo. Because it also triggers on `issues:
opened`, an issue whose body contains `@claude` starts a run when created.
