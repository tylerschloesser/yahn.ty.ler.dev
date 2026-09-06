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

## Five CloudFront gotchas, each of which cost thai.ler.dev a debugging session

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

### 5. A POST **with a body** through OAC needs `x-amz-content-sha256` from the viewer

thai's fifth gotcha, predicted here for Epoch 4 and **reproduced against `pr-7` on 2026-09-05**:

| Request through the enrichment behavior | Result |
| --- | --- |
| `GET` | 200, streams |
| `POST` with an empty body, no extra header | 200, streams |
| `POST` with a body, no `x-amz-content-sha256` | **403 `SignatureDoesNotMatch`** |
| `POST` with a body **and** `x-amz-content-sha256: <sha256 of body>` | 200, streams |

Origin access control signs the origin request with SigV4, and SigV4 covers a hash of the
payload that CloudFront cannot compute for you — so the *viewer* has to supply it. That is a
real burden on every client (`SubtleCrypto` in a browser) and it rules out `EventSource`, which
only issues GETs.

**So the enrichment endpoint is a `GET`.** Everything it needs is an item id, which fits in the
path, so the body bought nothing and would have cost every caller a payload hash. `.claude/rules/api.md`
reserved the prefix as `POST /api/v1/enrich/**`; that reservation was about the *prefix*, and
the method was decided by this measurement. `ALLOW_ALL` stays on the behavior so the answer stays
re-testable without a redeploy.

## `compress` on a streaming behavior: measured, and it is a no-op

The plan flagged `compress: true` as "probably wrong — gzip wants a whole body and buffering is
what streaming must avoid", explicitly as a hypothesis. **It is not what happens.** Measured on
`pr-7` with two behaviors over the same origin, one `compress: true` and one `compress: false`
(the second behavior was temporary and has been deleted — recreate it to re-check):

- Compression **never happened at all**. Every response came back with no `content-encoding`,
  with `Accept-Encoding: gzip, deflate, br` on the viewer request. CloudFront does not compress
  `text/event-stream`.
- It did **not** buffer. Events arrived 500ms apart under both settings.
- It costs nothing measurable. 30 interleaved pairs, alternating which variant went first:
  median TTFB 0.212s (compress off) vs 0.214s (on), paired difference **+0.003s median**,
  −0.073s to +0.687s, with `on` slower in 17 of 30 pairs — a coin flip.

**The first version of this measurement said otherwise, and it was wrong.** Twelve pairs with
`off` always sampled first produced medians of 0.232s vs 0.555s, which reads as a 2.4x
regression. Alternating the order erased it: the gap was the position in the pair, not the
setting. This is Epoch 3's lesson arriving a second time — *interleave, and randomize order, or
you are measuring your harness.*

`compress: false` stays on the behavior anyway, because it says what is meant — these responses
are not compressible — not because it was shown to be faster.

## Streaming through CloudFront: it works, and here is the shape that works

Proven end to end on `pr-7` before any of Epoch 4 was built on it: `hono/aws-lambda`'s
**`streamHandle`** → a function URL with `invokeMode: RESPONSE_STREAM` → a `CACHING_DISABLED`
behavior. First byte at 0.21s, events arriving incrementally at their origin cadence, both
locally and through the edge. No hand-rolled `awslambda.streamifyResponse`.

Three things about that chain are load-bearing:

- **`RESPONSE_STREAM` is fixed when the function URL is created.** A buffered URL cannot be
  promoted; it has to be replaced. This is the whole reason enrichment is a second Lambda rather
  than a route on the read one.
- **`readTimeout` on the origin is the real deadline, not the Lambda timeout.** It is what
  CloudFront waits for the first byte *and* between subsequent packets, and 60s is the ceiling
  without a quota increase. A producer that goes quiet longer than that is cut off at the edge
  while the Lambda happily keeps running. Anything that waits on a model must emit something —
  the enrichment stream sends a `meta` event before any model work starts for exactly this.
- **The enrichment function does not inherit the read function's 512MB reasoning.** Cost is
  memory x duration, and this one spends most of its wall clock blocked on a model call, so
  buying vCPU for the blocked part is pure waste. It is 512MB on its own terms, not by
  inheritance, and its 5-minute timeout is an outer bound on a stream still making progress.

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
  carries `pnpm verify`, `pnpm e2e`, and the `gh issue`/`gh pr` reads the `file-issue` skill
  needs — without those the run could not even file a ticket about being unable to test, and had
  to leave the finding in a comment. **If you add a check to `pnpm verify`, check this line too.**
- **`pnpm e2e` needs `playwright install --with-deps chromium`,** which `ci.yml` does and this
  workflow did not. An allowlist entry without the browser is a false promise.
- **Every run costs two workflow runs.** The action posts its own "Claude Code is working…"
  comment, which fires `issue_comment: created` again; the second run evaluates the `if:` and
  reports `skipped`. Normal, not a loop, and not worth guarding against.

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
