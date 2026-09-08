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

**If the CDK CLI or `cdk-core sweep` says `Session token not found or invalid` while
`AWS_PROFILE=admin aws sts get-caller-identity` works**, the AWS CLI is running on cached role
credentials the JS SDK does not share. Hand the JS tools the same credentials:
`eval "$(aws configure export-credentials --profile admin --format env)"`, then run the command
in that shell. Seen on 2026-09-07 during the migration, on a token with 50 minutes left, for
both the CDK CLI and the sweeper; a fresh `aws sso login` is the other fix.

> **The account hosts thai.ler.dev's live production stacks** (`ThaiLerDevSiteStack`,
> `ThaiLerDevGithubOidcStack`), cdk-core's own site (`CdkCore*`), and other unrelated production
> stacks. Never `destroy` or `delete-stack` a name you have not just read back from
> `aws cloudformation list-stacks`. `cdk destroy` and `delete-stack` are deliberately absent
> from `.claude/settings.json`.

## The five stacks, and what is the package's

`infra/cdk` is one file, `bin/app.ts`: a single `defineSiteStacks()` call into
**`@tylerschloesser/cdk-core`** (pinned in the catalog). Stack *knowledge* — domain, zone,
account, the two Lambdas, the table, the secret — lives here. The *mechanism* — the
distributions, the preview router, OAC, the deploy role, the sweeper — is the package's, and so
are its hard-won rules: cdk-core's `.claude/rules/cdk.md`, `cloudfront-origins.md`,
`streaming-and-kvs.md` and `workflows.md`. **Do not re-implement what the package handles**: the
`lambda:InvokeFunction`-alongside-`InvokeFunctionUrl` grant, `ALL_VIEWER_EXCEPT_HOST_HEADER`,
the SPA fallback as a CloudFront Function — now on **every** behavior except `/auth/*`, because
it also carries the edge gate — the API living inside
the site stack, and the asymmetric-`prune` `BucketDeployment` pair are all inside `Site` now.
Each of them cost a debugging session once; the way to keep that paid is to not write a second
copy.

| Stack | Deployed by | Holds |
| --- | --- | --- |
| `YahnShared` | `deploy.yml`, and by hand first | the one ACM certificate, SANs `[yahn.ty.ler.dev, *.preview.yahn.ty.ler.dev]` |
| `YahnPreview` | `deploy.yml` (rarely changes) | preview bucket, KeyValueStore, router function, the preview distribution, wildcard DNS, SSM params, **the preview Cognito pool + machine client + machine user + its secret, the preview session secret + shared `/auth/*` Lambda** |
| `YahnSite` | `deploy.yml` on `main` | prod bucket, distribution, apex DNS, **both Lambdas, the `EnrichTable`, the log groups, the prod Cognito pool, the gate's KeyValueStore + session secret + `/auth/*` Lambda** |
| `Yahn-pr-<n>` | `pr-preview.yml` per PR | that PR's two Lambdas + a `PreviewDeployment` (assets under `pr-<n>/`, one KVS key) |
| `YahnGithubOidc` | **you, locally, once** | the `yahn-github-deploy` role; its ARN is the `AWS_DEPLOY_ROLE_ARN` repo variable |

- **A workflow step that polls an endpoint anonymously now gets a `302`, and `curl -f` does not
  fail on one.** Both wait-loops (`pr-preview.yml`, `deploy.yml`) used `curl -fsS .../api/health`
  and so read the gate's redirect as success — they passed while checking nothing. They compare
  `%{http_code}` now: on preview "not 404" means the router resolved the host (a missing KVS key
  is the 404), on prod a 302 or 200 means the distribution answered. The same trap applies to any
  new step you add. `.claude/rules/testing.md` has the matching change to the e2e runs, including
  why the prod post-deploy run is now only `e2e/auth.spec.ts`.
- **The site is gated at the edge (`auth.gate: 'edge'`), and that spends most of a hard quota.**
  A CloudFront Function may be **10,240 bytes and the limit is not adjustable**. Yahn's gated
  preview router is **6,426** of it — the mechanism, the measurements and the traps are cdk-core's
  `.claude/rules/edge-gate.md`, and there is a test there that fails at 8,192 so a third backend
  cannot quietly walk into the wall. Prod gains a **KeyValueStore of its own** (the gate has no
  environment variables, so the HMAC secret is read with `kvs.get()`), and both distributions gain
  an `/auth/*` behavior that is `CACHING_DISABLED` and carries no function. Adding a backend now
  costs ~539 bytes of that budget as well as a path pattern.

- **`YahnGithubOidc` never deploys from CI** — it grants CI the trust CI would need to deploy it.
  No workflow names it. **It imports the account's OIDC provider, never creates one**; the
  provider is owned by `ThaiLerDevGithubOidcStack`.
- **Preview stacks are selected by CDK context**: `cdk deploy Yahn-pr-7 --exclusively -c pr=7`.
  Without `-c pr=`, `cdk list` shows exactly the four permanent stacks. `defineSiteStacks`
  rejects a non-numeric `pr`, so the stack name cannot be forged from a context value, and the
  sweeper's anchored `^Yahn-pr-[0-9]+$` depends on that.
- **A PR stack reads `YahnPreview`'s SSM parameters, not CloudFormation exports**, which is what
  lets it deploy with `--exclusively` and be deleted while the shared stacks stay put. The
  certificate is the one construct reference that crosses stacks (`YahnShared` → the other two);
  there is no hard-coded certificate ARN any more.
- **The `functions` factory gets exactly one prod-versus-preview signal:**
  `Stack.of(scope).stackName === 'YahnSite'`. `defineSiteStacks` calls the factory once for
  `YahnSite` and once per `Yahn-pr-<n>`, and the stack name is the only thing that differs. It
  decides the `EnrichTable`'s removal policy (RETAIN in prod, where summaries cost real money to
  regenerate; DESTROY in a preview, which the sweeper deletes on a cron) and the log groups'
  retention and policy (two years + RETAIN, one week + DESTROY).
- **The two Lambdas' log groups are explicit and stack-owned here**, so a PR stack's delete
  takes them with it, and their names are `YahnSite-ApiLogs…`, not `/aws/lambda/…`. The
  package's **custom-resource** Lambdas (bucket deployment, the preview-resources handler and
  its provider) still create implicit `/aws/lambda/Yahn-pr-<n>-…` groups on first invoke that
  no stack owns — `Yahn-pr-11` left three behind on 2026-09-07 — and that is precisely what
  `cdk-core sweep`'s fourth step (`^/aws/lambda/Yahn-pr-`) reclaims once the PR is closed. The
  old stacks had leaked 24 `/aws/lambda/YahnAppStack-*` groups; those were deleted by hand.

## `cdk.context.json` is committed, and it can go stale

`YahnGithubOidc` scopes the role's KVS and S3 grants to `YahnPreview`'s KeyValueStore ARN and
bucket name, read with `ssm.StringParameter.valueFromLookup` because a dynamic reference cannot
appear inside an IAM resource ARN. Lookups are cached in `infra/cdk/cdk.context.json`, which is
therefore **committed**, and which is why `cdk synth` of any stack works with no credentials: the
CDK CLI resolves missing context for the whole app before selecting stacks, so without the file
even `synth YahnShared` would ask for AWS.

**If `YahnPreview` is ever recreated, those two values change and the file is wrong** — the role
ends up scoped to a dead ARN and the sweeper starts failing with `AccessDenied`. Delete the two
`ssm:…/preview/{kvsArn,bucketName}` entries, run `AWS_PROFILE=admin pnpm --filter @yahn/cdk exec cdk synth`,
commit the result, and redeploy `YahnGithubOidc` by hand.

## The certificate's validation record is shared, and deleting the old stack may take it

ACM validates a domain and its wildcard with **one** CNAME, `_<hash>.yahn.ty.ler.dev`. The old
`YahnSharedStack` certificate (`yahn.ty.ler.dev` + `*.yahn.ty.ler.dev`) and the new `YahnShared`
one (`yahn.ty.ler.dev` + `*.preview.yahn.ty.ler.dev`) both need that record for the apex name,
and CloudFormation created it under the *old* stack. Deleting the old stack could have removed
it, and the new certificate would then fail to **auto-renew in 13 months with no error
anywhere** — ACM only reports it when renewal is already overdue.

**Measured 2026-09-07: it survived.** `YahnSharedStack` was deleted after `YahnShared` had
issued its certificate against the same `_834f9b6b….yahn.ty.ler.dev` record, and the record was
still in the zone afterwards. That is one observation of CloudFormation's behaviour, not a
guarantee, so after any deletion of a certificate stack for this domain, re-check:

```
aws acm describe-certificate --region us-east-1 --certificate-arn <new cert> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
aws route53 list-resource-record-sets --hosted-zone-id Z038502736IM0QLQT7VFN \
  --query "ResourceRecordSets[?Type=='CNAME' && contains(Name, 'yahn')]"
```

Every `ResourceRecord` the first command prints must appear in the second. If one is missing,
recreate it by hand from the `Name`/`Value` pair; the certificate reports `SUCCESS` for that
domain again within minutes.

## Conventions

- **`pnpm build` runs before any `synth`, `deploy` or `destroy`.** `Site` and
  `PreviewDeployment` read `apps/web/dist` and throw without it, and `PreviewSite` reads the
  package's bundled handlers from `node_modules/@tylerschloesser/cdk-core/dist/handlers/`.
  `pr-teardown.yml` is the exception because it never synthesizes: it is a raw `delete-stack`.
- `cdk.json` is two keys (`app`, `output`) and nothing else. The stacks are new, so no feature
  flag is load-bearing for template compatibility; the reference site ships the same file.
- **Node 24 and `NODEJS_24_X` stay.** The package pins only its own custom-resource handlers to
  22; a consumer's Lambdas are the consumer's. Bundling targets `node24`, `@aws-sdk/*` is
  external because the runtime ships it, and `@yahn/hn` / `@yahn/schema` are workspace *source*
  consumed through `exports` maps — esbuild must bundle them, so never add them to
  `externalModules`, and no `depsLockFilePath`.
- `esbuild` is a **root** devDependency, not this package's: `NodejsFunction` runs the bundler
  from the workspace root where the lockfile is. Without it CDK silently falls back to Docker.
- `bin/app.ts` has no relative imports, so the old ".js extensions on relative imports" rule has
  nothing left to apply to. If a second file ever appears here, the app runs through `tsx` under
  `nodenext` and that rule returns.

## Auth: which stack owns which pool, and the SSM sequencing trap

One `auth` key in `bin/app.ts` turns all of it on. `defineSiteStacks` then creates the prod pool
in `YahnSite`, the preview pool plus a `machine` app client, the `claude` native user and the
`yahn.ty.ler.dev/preview-machine-user` secret in `YahnPreview`, four more SSM params, and
`AUTH`/`AUTH_ISSUER`/`AUTH_CLIENT_ID` on **both** backend Lambdas in every stack.
`.claude/rules/auth.md` is the mechanism; this section is only what `infra/cdk` and the workflows
have to get right.

- **The two `domainPrefix` values (`yahn-ty-ler-dev`, `yahn-ty-ler-dev-preview`) are written out
  rather than defaulted**, because the same two strings appear in the shared
  `cdk-core/google-oauth` client's authorized redirect URIs, which no API manages. Renaming one
  here without a human editing Google's console is a `redirect_uri_mismatch` **at Google, with
  nothing in any AWS log**.
- **`oauth.preview.yahn.ty.ler.dev` needs no DNS work.** The bounce host resolves through the
  permanent `*.preview.yahn.ty.ler.dev` A/AAAA records, and the certificate's
  `*.preview.yahn.ty.ler.dev` SAN already covers it. Nothing was added for it.
- **The SSM sequencing trap, and it fails the deploy rather than the synth.** `PreviewDeployment`
  reads `authIssuer` / `authClientId` / `authMachineClientId` / `authDomain` with
  `ssm.StringParameter.valueForStringParameter`, which renders a `{{resolve:ssm:…}}` dynamic
  reference that **CloudFormation** resolves. So `cdk synth Yahn-pr-<n> -c pr=<n>` succeeds with
  no credentials and no params, and the failure only appears when `pr-preview.yml` deploys — as a
  CloudFormation error that does not name the cause. Those four params are created by
  `YahnPreview`, so **`YahnPreview` must be deployed before the first PR preview that reads
  them**:
  ```
  eval "$(aws configure export-credentials --profile admin --format env)"
  pnpm build && pnpm --filter @yahn/cdk exec cdk deploy YahnPreview
  ```
  A PR stack synthesized from a branch whose `bin/app.ts` has **no** `auth` key never reads them,
  so open PRs predating this are unaffected until they rebase.
- **The edge gate repeats that bootstrap, one layer worse, and it bit on the PR that added it.**
  With `auth.gate`, a PR stack's backend Lambdas also carry `AUTH_SESSION_SECRET`, a
  `{{resolve:secretsmanager:yahn.ty.ler.dev/preview-session-secret:…}}` dynamic reference. That
  secret is created by `YahnPreview`, so before `YahnPreview` is deployed the PR stack fails at
  **`ApiFn` creation** with `Secrets Manager can't find the specified secret`
  (`ResourceNotFoundException`) and rolls the whole stack back. The message names the secret but
  not the stack that owes it, and `cdk synth` is perfectly happy — same shape as the SSM case
  above, same fix, same command. `pr-preview.yml` deploys only `Yahn-pr-<n> --exclusively`, and
  `deploy.yml` (on `main`) is the only thing that deploys `YahnPreview`, so **the PR that
  introduces the gate cannot get a working preview until `YahnPreview` is deployed by hand from
  that branch.** Deploying it also puts the gate on the *shared* preview distribution, so every
  other open PR's preview becomes gated at the same moment — check `gh pr list` first.
- **`YahnGithubOidc` needed no redeploy for this** — `cdk diff` reported *no differences*, and its
  policy already grants `secretsmanager:GetSecretValue` on
  `yahn.ty.ler.dev/preview-machine-user-*`, which is the only IAM permission the machine-login
  path needs. `initiate-auth` is unauthenticated and is called `--no-sign-request`.
- **Cognito's free tier is 10,000 MAU per account**, so two more pools alongside thai's and
  cdk-core's cost $0.

## Caching — the deliberate divergence from thai, now expressed through the package

thai's `/api/*` is `CACHING_DISABLED`, correct for a per-user sync API and wrong here. Ours is
`CachePolicies.originDecides` — `minTtl 0 / defaultTtl 0 / maxTtl 300s`, query strings `all`,
no headers, no cookies, brotli + gzip — the policy the package carried over from this repo.
**`defaultTtl: 0` is what makes CloudFront honor the origin's own `Cache-Control`**; the origin
is the authority (`.claude/rules/api.md`), and `maxTtl` is the ceiling on one that misbehaves.

- It is passed as a **factory**, `cachePolicy: (scope) => CachePolicies.originDecides(scope)`,
  because `backends` is a static record built before any stack exists. That factory form is
  cdk-core 0.1.2's, added for this migration; `Site` calls it once per backend with itself as
  scope.
- **Previews ignore it and are always `CACHING_DISABLED`** — one distribution serves every open
  PR and the router cannot vary the cache key by host. So a preview never proves an edge-caching
  claim; measure `x-cache` on prod only.
- **`compress: true` on `/api/*` goes through `behaviorOverrides`**, because the package
  hard-codes `compress: false` for every backend. A 718 KB item JSON wants brotli, and the
  policy already keys on `Accept-Encoding`. The streaming behavior keeps the default `false`,
  measured below.
- **`behaviorOverrides` reaches the preview distribution too** — the package has no
  per-distribution override, so `YahnPreview`'s `/api/*` also synthesizes `Compress: true`, and
  **measured on `pr-11`, it is live there**: `/api/v1/items/1` came back `content-encoding: gzip`
  under `CACHING_DISABLED`. The first draft of this bullet predicted a no-op; it was wrong. That
  is fine — a preview's item JSON is as big as prod's — and the streaming behavior is untouched
  because only `api` carries the override. Anything added to `behaviorOverrides` lands on both
  distributions; a prod-only override has no home in the package today.

## `compress` on a streaming behavior: measured, and it is a no-op

Measured on the old `pr-7` with two behaviors over the same origin, one `compress: true` and one
`compress: false` (the twin behavior was temporary; recreate it via `siteOverrides.additionalBehaviors`
to re-check):

- Compression **never happened at all**. Every response came back with no `content-encoding`,
  with `Accept-Encoding: gzip, deflate, br` on the viewer request. CloudFront does not compress
  `text/event-stream`.
- It did **not** buffer. Events arrived 500ms apart under both settings.
- It costs nothing measurable: 30 interleaved pairs, alternating which variant went first,
  median TTFB 0.212s (off) vs 0.214s (on), paired difference **+0.003s median**, `on` slower in
  17 of 30 — a coin flip.

**The first version of this measurement said otherwise, and it was wrong.** Twelve pairs with
`off` always sampled first read as a 2.4x regression; alternating the order erased it. *Interleave,
and randomize order, or you are measuring your harness.* `compress: false` stays because it
says what is meant, not because it was shown to be faster.

## Streaming through CloudFront: it works, and here is the shape that works

`hono/aws-lambda`'s **`streamHandle`** → a function URL with `invokeMode: RESPONSE_STREAM`
(the package adds it from `streaming: true`) → a `CACHING_DISABLED` behavior on `/events/*`.
First byte at 0.21s, events at their origin cadence, locally and through the edge. Three things
about that chain are load-bearing:

- **`RESPONSE_STREAM` is fixed when the function URL is created.** A buffered URL cannot be
  promoted; this is the whole reason enrichment is a second Lambda rather than a route.
- **The origin `readTimeout` is the real deadline, not the Lambda timeout.** The package sets 60s
  for a streaming backend, which is what CloudFront waits for the first byte *and* between
  packets. Anything that waits on a model must emit something — the stream sends `meta` before
  any model work and keepalive comments every 15s for exactly this.
- **The enrichment function is 512MB on its own terms**, not by inheritance: it spends most of
  its wall clock blocked on a model call, and its 5-minute timeout is an outer bound on a stream
  still making progress, not the SLA.
- **The two path patterns are a contract.** `/api/*` and `/events/*` are shared by `Site`,
  `PreviewSite`, `apps/web`'s fetches and Vite's proxy, and they must not overlap: cdk-core's
  preview router refuses one pattern that is a prefix of another, because a CloudFront Function
  cannot change which behavior was selected. That is why enrichment moved from `/api/v1/enrich`
  to its own root.

### A POST **with a body** through OAC needs `x-amz-content-sha256` from the viewer

Reproduced against the old `pr-7` on 2026-09-05:

| Request through the streaming behavior | Result |
| --- | --- |
| `GET` | 200, streams |
| `POST` with an empty body, no extra header | 200, streams |
| `POST` with a body, no `x-amz-content-sha256` | **403 `SignatureDoesNotMatch`** |
| `POST` with a body **and** `x-amz-content-sha256: <sha256 of body>` | 200, streams |

Origin access control signs the origin request with SigV4 over a payload hash CloudFront cannot
compute, so the *viewer* has to supply it — a real burden on every client, and it rules out
`EventSource`. **So the enrichment endpoint is a `GET`.** The package's default `ALLOW_ALL` on
the streaming behavior stays so the answer is re-testable without a redeploy.

## The preview lifecycle

`pr-preview.yml` (open/synchronize/reopen) → `pr-teardown.yml` (close) → `cleanup.yml` (daily).
Previews answer at **`https://pr-<n>.preview.yahn.ty.ler.dev`**: one shared distribution whose
router reads a KeyValueStore keyed by hostname, rewrites assets to `pr-<n>/` in the shared
bucket, and re-points `/api/*` and `/events/*` at that PR's Lambda URLs per request.

- **A preview deploy is one stack of two Lambdas plus asset upload and a KVS write**, not a
  CloudFront distribution create. Measured on this site on 2026-09-07: PR #11 (the migration)
  `deploy 97 s · push → comment 223 s`, PR #12 (an empty commit) `deploy 95 s · push → comment
  202 s`, against the old clone-per-PR's ~6 min. Teardown: the workflow ran in 17 s, the stack
  was gone and the host answered 404 from outside within ~100 s of the close. The sticky comment
  on every PR reports the same two numbers, so drift shows up without anyone timing it.
- **The comment also carries a QR of the preview URL**, so a phone scans it instead of retyping
  the host. It is an `api.qrserver.com` image because GitHub strips `data:` URIs and inline
  `<svg>` from comments; camo caches it, so an existing comment survives the service going away.
  Re-check with
  `curl -sSI "https://api.qrserver.com/v1/create-qr-code/?size=180x180&qzone=2&data=https%3A%2F%2Fpr-14.preview.yahn.ty.ler.dev"`,
  expecting `200` and `image/png` — a broken image in a *new* comment is that service, not the
  preview. **This workflow is an adapted copy of cdk-core's template, not a rendered instance**,
  and it has already diverged in four ways the placeholders do not cover: `node-version: 24` vs
  22, `--filter @yahn/cdk` vs `infra`, `/api/health` vs `/api/ping`, and a root
  `pnpm exec playwright` vs `--filter e2e`. Nothing detects that drift, so a change worth having
  in both — the QR was one — is made in both repos by hand.
- **`cancel-in-progress: false` on everything that touches CloudFormation is load-bearing.**
  Cancelling the job does not cancel the deploy it started; the next push would find the stack
  `UPDATE_IN_PROGRESS`. `pr-teardown.yml` shares the *same* concurrency group so a teardown can
  never race a deploy for the same PR. Only `ci.yml` cancels.
- **Both deploy paths poll `/api/health` before Playwright**, but for a different reason than
  before: the wildcard DNS record is permanent, so NXDOMAIN is no longer the failure mode. KVS
  writes reach the edge on no published SLA, so `CREATE_COMPLETE` does not mean the router
  knows the hostname yet. A local Playwright failure right after a deploy is the router, not
  your resolver.
- **`pr-teardown.yml` has no checkout, no build and no CDK**: a raw `delete-stack`, no wait, so a
  PR whose branch no longer builds still tears down. The stack's own `autoDeleteObjects` helper
  and its `KvsRoute` custom resource remove the assets and the hostname as part of the delete.
  `gh pr comment` needs `GH_REPO` because there is no git remote to infer from — do not "fix"
  that by adding a checkout.
- Fork PRs get no preview, and that is correct: GitHub will not grant `id-token: write` to a
  fork PR. Both PR workflows carry the same explicit guard.

## `cleanup.yml` is the only scheduled thing that deletes, and three guards stand between its cron and the account

It runs `cdk-core sweep --site yahn.ty.ler.dev --stack-prefix Yahn --repo tylerschloesser/yahn.ty.ler.dev`,
which reconciles four things against the list of open PRs: `Yahn-pr-<n>` stacks, KVS keys,
`pr-<n>/` prefixes in the preview bucket, and `/aws/lambda/Yahn-pr-*` log groups.

1. **The sweeper's own anchored `^Yahn-pr-[0-9]+$`**, which rejects `YahnSite` and `Yahn-pr-x`.
2. **IAM, and this is the one that survives a rewrite of the sweeper or a workflow**: the deploy
   role's `cloudformation:DeleteStack` is scoped to `stack/Yahn-pr-*` and its
   `logs:DeleteLogGroup` to `log-group:/aws/lambda/Yahn-pr-*`; `ListStacks` and
   `DescribeLogGroups` are `*` because those actions take no resource. It is `GithubDeployRole`'s
   policy inside the package, so it is not yours to loosen, but it is yours to **re-check with
   `aws iam simulate-principal-policy`** whenever the package version changes: `Yahn-pr-1`
   allowed, `YahnSite`, `ThaiLerDevSiteStack` and `CDKToolkit` `implicitDeny`. Widening it means
   a **local** hand deploy of `YahnGithubOidc`, never a workflow.
3. **Locally, only the dry run is allowlisted**, as the full literal command in
   `.claude/settings.json`. It exits non-zero if it *would* delete anything, so a green dry run
   is a positive statement that the account is clean:
   `GH_TOKEN=$(gh auth token) AWS_PROFILE=admin pnpm --filter @yahn/cdk exec cdk-core sweep --site yahn.ty.ler.dev --stack-prefix Yahn --repo tylerschloesser/yahn.ty.ler.dev --dry-run`.
   **Proven on this site 2026-09-07**: after PRs #11 and #12 closed, the real sweep
   (`cleanup.yml`, dispatched by hand) deleted their six leaked custom-resource log groups and
   nothing else, and the dry run then exited 0.

The deploy role trusts `ref:refs/heads/main` and `pull_request` and nothing else, in both the
legacy and the immutable `sub` forms — so a `workflow_dispatch` from another branch is refused
at `AssumeRoleWithWebIdentity`. Test a workflow change through a PR.

## claude.yml

thai's file, on node 24: the Claude Code GitHub Action, interactive mode, gated on `@claude`.
**Proven 2026-09-05** — it fixed issue #4 end to end, pushing `claude/issue-4-*`. It needs the
`CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`, chosen over an API key because the
account's carries no credit) and the Claude GitHub App; both are in place. It also triggers on
`issues: opened`, so an issue whose body contains `@claude` starts a run when created — which is
why the `file-issue` skill forbids that phrase in a title or body. **A comment is how you start
a run**, and Claude may write that comment.

Three things its first run taught, all now fixed here:

- **`--allowedTools` is a second, narrower allowlist than `.claude/settings.json`,** and the
  run obeys the intersection. It started with lint/typecheck/build only, so the run could not
  execute `pnpm test` or `pnpm e2e` and shipped a correct fix it had no way to verify. It now
  carries `pnpm verify`, `pnpm e2e`, the `gh issue`/`gh pr` reads the `file-issue` skill needs,
  and `gh pr checks`/`gh run view`/`sleep` for the wait below. **If you add a check to
  `pnpm verify`, check this line too.**
- **`pnpm e2e` needs `playwright install --with-deps chromium`,** which `ci.yml` does and this
  workflow did not. An allowlist entry without the browser is a false promise.
- **Every run costs two workflow runs.** The action posts its own "Claude Code is working…"
  comment, which fires `issue_comment: created` again; the second run evaluates the `if:` and
  reports `skipped`. Normal, not a loop, and not worth guarding against.

**The action does not open a PR on its own, and the allowlist alone will not make it.** Its
built-in prompt says *"Provide a URL to create a PR manually"* — deliberate, so branch protection
stays with a human (`anthropics/claude-code-action` `docs/faq.md`). Issues #8 and #9 each ended
as a pushed `claude/issue-N-*` branch and a compare link, and #8's sat unclicked for a day. This
repo overrides that with **both halves**: `Bash(gh pr create:*)` on `--allowedTools` *and* an
`--append-system-prompt` telling the run to open the PR — the append lands after the built-in
prompt, which is why it wins. Drop either half and you are back to compare links. `gh` is
authenticated in the run from the OIDC-exchanged **Claude GitHub App** token, not the workflow's
`GITHUB_TOKEN`, which is also why the PR it opens **does** start `ci.yml` and `pr-preview.yml`
(the default-token rule that suppresses workflow-from-workflow events does not apply to an app
token).

**And then it has to wait for those runs.** Opening the PR was the last thing the run did, so
PR #22 was reported finished at 19:26:27 and its own `pr-preview.yml` run started at 19:26:16 —
the checks did not exist while the run that caused them was alive, and that preview then failed.
The fix is the same both-halves shape: `Bash(gh pr checks:*)`, `Bash(gh run view:*)` and
`Bash(sleep:*)` on `--allowedTools`, plus an instruction to `sleep 60` (checks take a moment to
register) and then `gh pr checks N --watch --interval 30 --fail-fast=false`, which **blocks** —
so there is no polling loop to get wrong. There is no timeout to raise: `claude-code-action@v1`
exposes no `timeout_minutes` input and this job sets no `timeout-minutes`, so the ceiling is
GitHub's 360-minute default and the ~7 idle minutes fit under it easily. Those minutes are the
real cost of the change, and they buy a run that cannot report "done" over a red PR.

## Lambda memory: 512 stays, and why the 1024 experiment proved less than it looked

1024MB was deployed to a preview and compared against 512MB on item 49563355 (1,603 nodes,
718KB), cache-busted with a random `?cb=` per request — the `/api/*` cache policy keys on the
full query string, which is how you force an origin miss.

| | 512MB (n=3) | 1024MB (n=3) |
| --- | --- | --- |
| origin miss | 2.71 / 2.92 / 2.95s | 2.42 / 2.56 / 2.63s |
| GB-s per request | 1.50 | 2.61 |

That reads as 11% faster for 74% more money — **but ten samples taken later against production,
same code and same memory, ran 3.69–4.88s with one at 27s.** Run-to-run variance on this endpoint
is wider than the gap the experiment measured, so **the experiment does not show that 1024 is
faster.** It shows only that if there is a difference it is small, while the 74% cost is certain.

512 therefore stays — a decision on *absence of demonstrated benefit*, not on a measured
regression. If it is ever revisited, the way to do it properly is many samples interleaved
between the two sizes in the same minutes, not three of each an hour apart. The hypothesis that
motivated the experiment (1,600 fetches plus a 718KB serialize being CPU-bound at ~0.3 vCPU) is
still unsupported: this endpoint waits on Firebase.

**The `timeout: Duration.seconds(30)` is closer to being hit than it looks.** One of those ten
production samples took **27s** — a Lambda cold start on the biggest thread on HN. That is 3
seconds of headroom, and `descendants` on a busy thread only grows. If items start returning 502s
in bursts, this is the first thing to check, and raising the timeout is the wrong first move: the
node cap (`HN_TREE_NODE_CAP`, 2000) and `truncated` exist precisely so a huge thread degrades
into a prefix rather than into an error.
