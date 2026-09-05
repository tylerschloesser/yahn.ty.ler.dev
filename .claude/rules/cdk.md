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
  deploy it. No workflow names it, and a grep proving that is part of the workflows' own check.
- **It imports the OIDC provider, never creates one.** One provider per issuer per account, and
  `ThaiLerDevGithubOidcStack` already made it. `new iam.OpenIdConnectProvider(...)` here is the
  single most likely first-deploy failure.
- Its trust carries **four** `sub` values: the legacy and immutable forms of both
  `ref:refs/heads/main` and `pull_request`. Which form GitHub emits is a property of the repo,
  not of the policy, so both stay. Both paths are proven — `deploy.yml` and `pr-preview.yml` have
  each assumed the role.
- **`YahnSharedStack` exists so previews never wait on certificate issuance** — 160s to issue,
  measured, against a preview that is six minutes end to end.
- **The certificate ARN is hard-coded in `bin/app.ts`.** An `Fn::ImportValue` would couple every
  preview to the shared stack and block deleting a preview while the export is in use; SSM would
  put an untested dynamic reference inside CloudFront's `ViewerCertificate`. Recreating the
  certificate is a one-line edit either way. `bin/app.ts` says this at the constant.
- **Preview stacks are selected by CDK context**: `cdk deploy YahnAppStack-pr-7 -c pr=7`. Without
  `-c pr=`, `cdk list` shows exactly the three permanent stacks. `bin/app.ts` rejects a
  non-numeric `pr`, so the stack name cannot be forged from a context value.

## Conventions

- ESM + `nodenext`: **relative imports here carry `.js` extensions** even though the sources are
  `.ts`, because the app runs through `tsx`. The **one** package in the repo that does.
- `AppStack` reads `apps/web/dist` and throws if it is missing, so **`pnpm build` runs before any
  `synth`, `deploy` or `destroy`** — including `pr-teardown.yml`'s destroy, which synthesizes the
  app like any other CDK command.
- `esbuild` is a **root** devDependency, not this package's: `NodejsFunction` runs the bundler
  from the workspace root where the lockfile is. Without it CDK silently falls back to Docker.
- `apps/api/src/lambda.ts` imports `@yahn/hn` and `@yahn/schema` as workspace **source** through
  their `exports` maps. esbuild must bundle them: never add them to `externalModules`, and no
  `depsLockFilePath` — `NodejsFunction` finds the root lockfile on its own.

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
   no `.`, so a missing asset still fails rather than silently returning the shell — but
   **measured, it fails 403, not 404**: an OAC bucket policy grants `s3:GetObject` and not
   `s3:ListBucket`, and without `ListBucket` S3 answers a missing key `AccessDenied`. The
   property that matters holds; the status code inherited from thai's rule file did not.
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

Measured on the first real run: create ~6 min, destroy ~4 min. The CloudFront distribution is
~4 of the 6 and is the only resource still pending at the end, so a *repeat* deploy to an
existing preview is far quicker — only its first creation is slow.

- **`cancel-in-progress: false` on `pr-preview.yml` is load-bearing.** Cancelling the job does
  not cancel the CloudFormation deploy it started; the next push would then find the stack in
  `UPDATE_IN_PROGRESS` and fail. `pr-teardown.yml` shares the *same* concurrency group so a
  teardown can never race a deploy for the same PR. Only `ci.yml` cancels — it leaves nothing
  behind server-side.
- **Both deploy paths poll `/api/health` before Playwright.** CloudFormation reports the stack
  complete before the new record has propagated, and Playwright burns all its retries on
  NXDOMAIN in about two seconds. A CI runner starts with a cold resolver so the gate is enough
  there; **your laptop may not**, because a resolver that was asked for `pr-<N>` before the
  record existed caches the NXDOMAIN. `dig` bypasses that cache and will disagree with `curl`
  and Playwright. Confirm with `curl --resolve pr-<N>.yahn.ty.ler.dev:443:<ip>` before believing
  a local failure is the preview's fault.
- **`cleanup.yml` is the only scheduled thing that deletes, and three guards stand between its
  cron and the rest of the account.** Two are in the workflow: the `YahnAppStack-pr-` prefix and
  an anchored `^[0-9]+$` on what follows it, which together reject `YahnAppStack-prod` (no
  trailing hyphen) *and* `YahnAppStack-pr-x`. The third is IAM, and it is the one that matters
  because it survives a rewrite of that shell loop: the deploy role's
  `cloudformation:DeleteStack` is scoped to `stack/YahnAppStack-pr-*`. Re-check with
  `aws iam simulate-principal-policy` rather than trusting this line — `pr-1` allowed, every
  other stack `implicitDeny`. **None may be loosened.**
- **That scope is also why the deploy role is not only `sts:AssumeRole`.** `cdk deploy`/`destroy`
  assume the CDK bootstrap roles and need nothing more, but `cleanup.yml` calls CloudFormation
  *directly as this role* — its stack list comes from AWS, not from the app — so the role also
  carries `ListStacks` (on `*`; the action takes no resource-level permissions). Its first run
  failed `AccessDenied ... cloudformation:ListStacks` for exactly this. Widening it means a
  **local** hand deploy of `YahnGithubOidcStack`, never a workflow.
- Fork PRs get no preview, and that is correct: GitHub will not grant `id-token: write` to a fork
  PR, so the deploy could not authenticate. Both PR workflows carry the same explicit guard.

## claude.yml

thai's file, on node 24: the Claude Code GitHub Action, interactive mode, gated on `@claude`.
**Committed but never run here** — it needs a `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude
setup-token`, chosen over an API key because the account's carries no credit) and the Claude
GitHub App installed; neither exists on this repo. It also triggers on `issues: opened`, so an
issue whose body contains `@claude` starts a run when created.
