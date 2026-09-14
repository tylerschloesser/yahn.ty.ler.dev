# PLAN — Epoch 1: foundation and the read-only clone

Plan for one Opus manager session. Inputs: `PRE-PLAN.md` (D1–D18, layout §5.1, salvage §6, context §8),
`PROMPT.md`, `docs/research/`. The old app is on `main`: read it with `git show main:<path>` and never
check it out. Regenerate this file for Epoch 2 once §6 passes.

## 0. Protocol

- **Manager (Opus)** decomposes and decides. It reviews the integrated diff at each gate (G0–G3), and it
  owns every outward-facing step: the M-chunks (Vercel project, GitHub secret, push, PR). It does not read
  source that an implementer can summarise.
- **implementer / verifier / researcher** are all `model: sonnet` (defined in C2). Each delegation prompt
  pastes its chunk verbatim. The verifier gets the chunk and its check, never the implementer's report,
  and answers PASS/FAIL/UNVERIFIABLE.
- Chunks in one wave touch disjoint files and run as parallel implementers. **Every dependency is added in
  C1**, so no later chunk edits `package.json` or the lockfile; a chunk that needs one stops and reports.
  The manager commits once per gate. Implementers never touch git.

## 1. Spike results (2026-09-13, throwaway project `yahn-spike`, Hobby)

**S1 — function entry** (verified at `https://yahn-spike.vercel.app`):
- `api/index.ts` is `import { app } from '../server/app.js'` plus `export default app`: the Hono app as a
  plain Web fetch handler, with no `hono/vercel` adapter and no `[[...route]]` file. C10 writes exactly:
  ```json
  { "functions": { "api/index.ts": { "maxDuration": 300 } },
    "rewrites": [ { "source": "/api/(.*)", "destination": "/api" },
                  { "source": "/(.*)", "destination": "/index.html" } ] }
  ```
- The `/api` rewrite is **required and must come first**: without it the SPA catch-all served `index.html`
  for `/api/health`. This contradicts `[hosting] §1`. Hono sees the original path, so main's literal
  `/api/v1/...` routes work unchanged.
- **Every relative import the function loads (`api/`, `server/`, `shared/`) must use a `.js` specifier.**
  Vercel transpiles file by file without rewriting specifiers. Main's `./x.ts` style builds, then crashes
  at runtime with `ERR_MODULE_NOT_FOUND`. A `.js` specifier resolves to the `.ts` source in tsc
  (`nodenext`), tsx, vitest, and Vite. TS errors do not fail a Vercel build, so `pnpm build` must typecheck.
- **CDN.** A repeat `GET` of an `s-maxage=60` route got `x-vercel-cache: HIT`. The client sees only
  `cache-control: public`, because Vercel strips `s-maxage`/`swr`. SSE streamed at 1 event/s and was
  never cached. Hono's `streamSSE` overwrites `Cache-Control` with `no-cache` (an Epoch 2 issue).
- Node **v24.19.0**, region **iad1**, plan **Hobby**. **The account's default Deployment Protection is
  Vercel Authentication on all deployments, production included**: a production `curl` got a 302 to SSO.
  `vercel link` wrote a `pnpm-workspace.yaml` that needs `pnpm approve-builds` for esbuild.

**S2 — Firebase tree walk on a Vercel function** (10 interleaved sequential requests each, c=128, cap 2000):
thread 36245435 (1609 comments) median 2.79s / max 6.49s; 47687273 (509) 1.32s / 2.24s; 38309611 (2530,
capped at 2000) 2.03s / 2.47s; peak RSS 293 MB. Three concurrent requests took 4.4s each on separate Fluid
instances; c=32 → 3.61s and c=256 → 2.55s median (n=3). No errors or 429s, and the worst case was 6.5s
against a 300s ceiling (main's 27s Lambda outlier did not reproduce). **Keep `HN_TREE_CONCURRENCY=128` and
`HN_TREE_NODE_CAP=2000`.**

## 2. Decisions assumed

| # | Assumption | Chunks |
| --- | --- | --- |
| U1 | **(b) from day one**: keep the account default (Vercel Authentication on all deployments, S1). Every remote check sends `x-vercel-protection-bypass`. Spend caps come in Epoch 2. | M1, C4, C10, §6 |
| U2 | Hobby (confirmed in S1): iad1, `maxDuration` 300. | M1 |
| U3 | `claude-opus-5` via env. No model code ships in Epoch 1. | — |
| U4 | Durable job model in Epoch 2. Epoch 1 keeps only the optional, loose `enrichments` slot. | C3 |
| U5 | Article summary in Epoch 3. | — |
| U6 | Port `tree/hybrid.ts` and its test; `COMMENT_SOURCE` defaults to `firebase`. | C3 |

Other assumptions (the manager confirms A1 and A2 with the user before M1):

- **A1 — history.** `vercel` shares no commit with `main` (`git merge-base` fails), so GitHub cannot open a
  PR. At M2: run `git merge -s ours --allow-unrelated-histories main` on `vercel` (this records `main` as a
  parent and keeps `vercel`'s tree), then open PR `vercel → main`. The production branch is `main` (D16).
  The merged `main` has no AWS workflows, and AWS stays up until Epoch 3.
- **A2 — project.** Vercel project `yahn`, scope `tylerschloessers-projects`, Git-connected to
  `tylerschloesser/yahn.ty.ler.dev`.
- **A3 — Node.** `engines.node` = `24.x` (Vercel honours it, S1) and CI uses 24. This machine has only Node
  22; the pnpm warning is acceptable.
- **A4 — scope cut.** `ThreadSummary`, `lib/sse.ts`, `enrich-stream.ts`, and `server/{enrich,jobs,store}`
  move to Epoch 2. The item page is `StoryHeader` + `CommentTree`.
- **A5 — PRE-PLAN corrections.** §5.2 omits `GET /api/v1/users/:id/items`, which `AuthorHistory` needs; it
  is ported. §7 lacks author-history fixtures; C6 adds them. `[hosting]`'s "no `/api` rewrite needed" is
  wrong (S1).
- **A6 — fixture seam (manager decision).** `HN_SOURCE=fixture` swaps the transport under
  `server/hn/http.ts`'s `fetchJson`, the one call site for all 7 HN requests. So e2e still runs the real
  clients, normalisers, and tree walk. An unrecorded URL throws `UpstreamError` naming the URL, which
  surfaces as a 502.
- **A7 — dark mode.** `tokens.css` uses `@media (prefers-color-scheme: dark)`; there is no pre-paint script.
- **A8 — pnpm.** Expect a settings-only `pnpm-workspace.yaml` (no `packages:`) for esbuild's `allowBuilds`
  (S1). It is not a workspace, so D1 holds.

## 3. Waves

| Wave | Parallel chunks | Gate (manager) |
| --- | --- | --- |
| 0 | C1 skeleton · C2 context files | G0: review configs and rules, commit |
| 1 | C3 schema + hn · C4 e2e specs (spec-first) · C5 tokens + styles · R1 researcher | G1: review specs as the contract, commit |
| 2 | C6 HN fixtures · C7 Hono app · C8 web port | G2: review integrated diff, verifier runs `pnpm verify`, commit |
| 3 | C9 e2e green under a minute | G3: commit |
| 4 | C10 vercel.json + CI · C11 context refresh, then M1 → M2 → M3 | §6 |

## 4. Chunks

Each chunk lists **Agent · Read first · Files · Edits · Check**. Every check runs from the repo root with
no context.

### C1 · Repo skeleton and tooling (wave 0)
- **Agent:** implementer → verifier. The manager fixes the scripts and the dependency list below.
- **Read first:** `git show main:.claude/rules/typescript-config.md`; PRE-PLAN D1, D11, D12, D18; §1 S1.
- **Files:** `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` (A8), `tsconfig{,.base,.app,.server,.node,.e2e}.json`,
  `vite.config.ts`, `vitest.config.ts`, `.oxlintrc.json`, `stylelint.config.js`, `.stylelintignore`, `.nvmrc`,
  `.gitignore` (+`generated`, `.vercel`, `test-results`, `playwright-report`). Delete `src/App.{tsx,css}`,
  `src/index.css`, `src/assets/`, `public/icons.svg`; `src/main.tsx` becomes a placeholder.
- **Edits — `package.json`:** `"engines": {"node": "24.x"}`; `packageManager` = the local pnpm. Scripts:
  - `dev` = concurrently `vite` + `tsx watch server/dev.ts`; `dev:e2e` = the same with `HN_SOURCE=fixture`.
  - `typecheck` = `cmk -p tsconfig.app.json && tsc -b`; `test` = `vitest run --passWithNoTests`.
  - `build` = `pnpm typecheck && vite build`; `verify` = `pnpm lint && pnpm typecheck && pnpm test && vite build`.
  - `lint` = `oxlint && stylelint "src/**/*.css" && pnpm lint:imports`, where `lint:imports` =
    `! grep -rnE "from '\.\.?/[^']*\.tsx?'" api server shared scripts` (the S1 guard).
  - `e2e` = `playwright test --project=chromium`; `e2e:live` = `playwright test --project=live`;
    `hn:record` = `tsx scripts/record-hn-fixtures.ts`.
- **Edits — dependencies** (PRE-PLAN §12 versions). Runtime: react, react-dom, @tanstack/react-router,
  @tanstack/react-query, @base-ui/react, zod, hono, @hono/zod-validator, @hono/node-server. Dev:
  @tanstack/router-plugin, @tanstack/react-router-devtools, @vitejs/plugin-react, vite, typescript `~6.0.3`,
  vitest `^4`, @playwright/test, tsx, concurrently, @types/node `^24`, @types/react(-dom), oxlint, main's
  stylelint set, @css-modules-kit/{codegen,ts-plugin,stylelint-plugin}. **Not** @radix-ui/colors,
  @aws-sdk/*, or cdk-core.
- **Edits — configs:**
  - Copy `tsconfig.base.json` and `tsconfig.e2e.json` verbatim from main. `tsconfig.app.json` = main's
    `apps/web` one with `include ["src","generated/src","shared"]`.
  - `tsconfig.server.json` = `nodenext`, `types ["node"]`, **no** `allowImportingTsExtensions`,
    `include ["api","server","shared","scripts"]`. The root tsconfig references app, server, node, e2e.
  - `vite.config.ts`: `tanstackRouter({target:'react', autoCodeSplitting:true})` before `react()`, plus
    `server.proxy {'/api': 'http://localhost:3001'}`. Drop the `/events` proxy and `localConfigJson`.
  - `.oxlintrc.json` and `stylelint.config.js` from main with `apps/web/src` → `src`. Stylelint's
    `importFrom` is `src/styles/tokens.css` only.
- **Check:** `pnpm install --frozen-lockfile && pnpm verify && grep -q '"node": "24.x"' package.json && test ! -e src/App.tsx`
- **Amended at G0** (the skeleton has no CSS, no server files, and no e2e files yet, so three tools fail on
  empty input): `lint` passes `--allow-empty-input` to stylelint; `tsconfig.server.json` and
  `tsconfig.e2e.json` add `"files": []` to avoid TS18003. Both stay. `typecheck` temporarily skips `cmk`
  while no `*.module.css` exists (cmk errors on zero files, with no flag to suppress it). **The manager
  restores `typecheck` to exactly `cmk -p tsconfig.app.json && tsc -b` at G2**, once C8 lands module CSS
  (done in wave 2).
- **Amended in wave 1:** `lint:imports` as written exits 0 whenever one of its directories is missing,
  because grep exits 2 and `!` negates that, so it silently passes real violations. It is now
  `! grep -rnsE "<same pattern>" api server shared scripts | grep .`, which fails exactly when a line
  matches.

### C2 · Context files (wave 0)
- **Agent:** implementer → verifier. The manager reviews every rule at G0.
- **Read first:** PRE-PLAN §8; `docs/research/main-branch-salvage.md` §8; §1 above;
  `git show main:CLAUDE.md`, `main:.claude/rules/{api,hn-data,testing,web-ui}.md`,
  `main:.claude/agents/*.md`, `main:.claude/skills/file-issue/SKILL.md`.
- **Files:** `CLAUDE.md`, `.claude/rules/{web-ui,api,hn-data,testing,vercel}.md`,
  `.claude/agents/{implementer,verifier,researcher}.md`, `.claude/skills/file-issue/SKILL.md`,
  `.claude/settings.json` (the §8 allowlist plus a `PreToolUse` hook refusing `Edit|Write` on
  `src/routeTree.gen.ts` and `generated/**`).
- **Edits:**
  - Port main's bodies. Drop every Cognito/CDK/Lambda/DynamoDB claim and use the §5.1 paths.
  - The implementer agent says dependencies go in `package.json`. Add `maxTurns: 30` to all three agents.
  - `vercel.md` carries all of §1 S1; `hn-data.md` carries the S2 conclusion. No `ai-jobs.md` (Epoch 2).
- **Check:** `test $(wc -l < CLAUDE.md) -lt 100 && for r in web-ui api hn-data testing vercel; do test $(wc -l < .claude/rules/$r.md) -le 120 || exit 1; done && ! grep -rliE 'cognito|cdk-core|dynamodb|AUTH=local|catalog:' CLAUDE.md .claude`

### C3 · Port `shared/schema` and `server/hn` with tests (wave 1)
- **Agent:** implementer → verifier.
- **Read first:** `.claude/rules/hn-data.md`, `.claude/rules/vercel.md`.
- **Files:** `shared/schema/{index,item,feed,response,enrichment}.ts`; `server/hn/**` (all source and the 7
  tests from `main:packages/hn/src`); `docs/hn-api.md`; `scripts/ordering-spike.mjs`.
- **Edits:** Copy verbatim, except: drop `MeResponseSchema`; skip `enrich-stream.ts` and its `export *`;
  rewrite the 42 `@yahn/schema` imports as relative `…/shared/schema/index.js` and **every** relative `.ts`
  specifier to `.js`. No logic changes; the defaults stay 128/2000 (S2).
- **Check:** `pnpm exec vitest run server/hn && pnpm typecheck && pnpm lint:imports && ! grep -rn "@yahn/" server shared`

### C4 · e2e specs, fixtures helper, Playwright config — spec first (wave 1)
- **Agent:** implementer → verifier. **The manager reviews at G1**: these specs are the contract for C6–C9.
- **Read first:** `.claude/rules/testing.md`; PRE-PLAN D8, D9, §6 testids, §7.
- **Files:** `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/hn-fixture.ts`, `e2e/fixtures/hn/manifest.json`
  (stub), `e2e/{smoke,feeds,thread,search-and-user}.spec.ts`, `e2e/live/hn.spec.ts`.
- **Edits — config (D9):** `fullyParallel`, `workers: CI ? 2 : undefined`, `retries: CI ? 1 : 0`,
  `expect.timeout: 5000`. `webServer` = `pnpm dev:e2e` when `PLAYWRIGHT_BASE_URL` is unset. When
  `VERCEL_AUTOMATION_BYPASS_SECRET` is set, `extraHTTPHeaders` sends the bypass header and
  `x-vercel-set-bypass-cookie: true`. Projects: `chromium` (ignores `e2e/live/**`) and `live` (only that).
- **Edits — fixtures:** `fixtures.ts` keeps `test.extend` and `TARGET` (`local | remote`) and loses all auth
  and AWS code. `hn-fixture.ts` reads the manifest:
  `{recordedAt, feeds:{[f]:count}, threads:{deep,shallow}, tombstoneId, user, search:{query,emptyQuery}}`.
- **Edits — specs:** Port main's 12 non-auth, non-summary tests with the §6 testids. Add fixture-content
  assertions under `test.skip(TARGET !== 'local')`, a `data-tombstone` test, and `GET /api/health` = 200.
  Tag three structural tests `@smoke` (rows, a thread opens, health). `live/hn.spec.ts` is structural only:
  six feeds, the busiest thread opens and collapses, a user page, a search.
- **Check:** `pnpm exec tsc -b tsconfig.e2e.json && pnpm exec playwright test --list --project=chromium | grep -E 'Total: 1[2-8] tests' && pnpm exec playwright test --list --project=chromium --grep @smoke | grep -q 'Total: 3 tests'`
- **Amended at G1 (contract review):** (1) Every test that reads the manifest runs only when
  `TARGET === 'local'`, and `@smoke` stays content-free. (2) The shallow-thread test asserts 1–30
  `comment`s and one `story-title`, not flatness. (3) `webServer.command` is `pnpm dev` when
  `HN_SOURCE=live` and `pnpm dev:e2e` otherwise, and `e2e:live` sets `HN_SOURCE=live`. (4) Stale
  main-history comments in the specs are removed.

### C5 · Tokens and global styles (wave 1)
- **Agent:** implementer → verifier.
- **Read first:** `.claude/rules/web-ui.md`, PRE-PLAN D14, `docs/research/client-stack.md` §5–6.
- **Files:** `src/styles/{reset,base,global,tokens}.css`, `index.html`.
- **Edits:** Port reset, base (adding `body { position: relative }`), and global. Hand-write `tokens.css`:
  HN literals `#ff6600`, `#f6f6ef`, `#828282`, `#000`, a dark set (A7), a 4px space scale, a type scale,
  and two radii. **Keep every custom-property name main's `*.module.css` files use**; change only values.
  Delete `primitives.css`. `index.html` = main's without the theme script.
- **Check:** `pnpm lint && git grep -ho 'var(--[a-z0-9-]*' main -- 'apps/web/src/**/*.module.css' | sed 's/var(//' | sort -u | while read v; do grep -q -- "$v:" src/styles/tokens.css || echo "MISSING $v"; done | grep -c MISSING | grep -qx 0`

### R1 · Researcher: preview smoke trigger (wave 1)
- **Agent:** researcher. It returns ≤20 lines, which the manager pastes into C10. **Questions:** Does
  Vercel's GitHub integration emit `deployment_status` to Actions (`state`, `environment`, `target_url`)?
  Is `VERCEL_AUTOMATION_BYPASS_SECRET` still the name? Does the bypass header affect CDN caching?
- **Check:** every claim cites a vercel.com/docs URL.

### C6 · HN fixture transport, recorder, recorded fixtures (wave 2)
- **Agent:** implementer (needs network) → verifier.
- **Read first:** `.claude/rules/hn-data.md`, `.claude/rules/testing.md`, `docs/hn-api.md`.
- **Files:** `server/hn/env.ts` (+`HN_SOURCE`), `server/hn/http.ts` (the seam only),
  `server/hn/fixture/{transport,transport.test}.ts`, `scripts/record-hn-fixtures.ts`,
  `e2e/fixtures/hn/{firebase,algolia,manifest}.json`, `.claude/skills/record-hn-fixtures/SKILL.md`
  (`disable-model-invocation: true`).
- **Edits (A6):** Fixture files map path+query to the verbatim body; missing items are `null`, and
  `If-None-Match` is ignored. The recorder drives the real `getFeed`, `getItem`, `getUser`,
  `getAuthorItems`, and `search` through a recording transport. It:
  - truncates feed id lists (`top` 60, i.e. two pages; every other feed 30);
  - picks `deep` (150–400 comments, at least one tombstone) and `shallow` (5–30), both on `top` page 1;
  - sets `user` = deep's author, recording the profile plus `all|story|comment` items;
  - records one search from deep's title and one with no hits.

  Keep the total under 2 MB.
- **Amended at G1 (from C4's specs):** `HN_SOURCE` is `live` (default) or `fixture`. The local suite opens
  the busiest thread on `top` page 1 and clicks the first story byline and the first comment byline.
  So the recorded `top` list is 60 real top ids with **`deep` at rank 1**, no other page-1 story has
  more `descendants` than `deep`, and `shallow` is on page 1. `user` (deep's author) must have at
  least one story and one comment in their history. Also record the profile and the `all` history of
  the first comment author in deep's preorder, which is the first `by` rendered.
- **Check:** `pnpm exec vitest run server/hn/fixture && test $(du -sk e2e/fixtures/hn | cut -f1) -lt 2048 && node -e "const m=require('./e2e/fixtures/hn/manifest.json');process.exit(m.threads.deep&&m.threads.shallow&&m.tombstoneId&&m.user?0:1)"`

### C7 · Hono app, dev server, Vercel entry (wave 2)
- **Agent:** implementer → verifier.
- **Read first:** `.claude/rules/api.md`, `.claude/rules/vercel.md`.
- **Files:** `server/app.ts`, `server/app.test.ts`, `server/env.ts`, `server/dev.ts`, `api/index.ts`.
- **Edits — `server/app.ts`** (from `main:apps/api/src/app.ts`):
  - Remove `./auth.ts`, `Variables`, the user `app.use`, and `/api/v1/me`.
  - Export `createApp(deps = realHn)` and `const app = createApp()`. Route strings stay literal
    `/api/...` (S1).
  - `CACHE` per D10: feeds `public, s-maxage=30, stale-while-revalidate=300`; items, users, author items,
    and search `public, s-maxage=60, stale-while-revalidate=300`.
  - Set `Vercel-Cache-Tag` (`feed:<name>`, `item:<id>`, `user:<id>`) after the await.
  - Keep `notFound`/`onError` (`no-store`). `/api/health` returns `{ok:true}` with `no-store`.
- **Edits — the rest:** `server/env.ts` = main's minus AUTH, AWS_REGION, anthropicSecretId, enrichPort,
  enrichTableName, store, modelProvider, and fakeModelDelayMs; keep `port` and an empty
  `applyLocalDefaults()`. `server/dev.ts`: one `serve()` on 3001. `api/index.ts`: exactly as in §1.
- **Edits — tests:** a feed 200 has `s-maxage=30` and the tag; `NotFoundError` → 404, `UpstreamError` →
  502, a bad feed → 400, all `no-store`; an unknown `/api/v1/x` → 404 JSON.
- **Check:** `pnpm exec vitest run server/app.test.ts && pnpm typecheck && pnpm lint:imports && ! grep -rniE "\bauth\b|getauthuser|/me'|aws" server/app.ts server/env.ts`
- **Amended in wave 2:** the check's grep was `"auth|/me'|aws"`, which matches `author`. The ported
  author-items route (A5) needs `getAuthorItems`, so the grep now matches `auth` only as a whole word
  or in `getAuthUser`.

### C8 · Port the web app (wave 2)
- **Agent:** implementer → verifier. One implementer covers all of `src/`.
- **Read first:** `.claude/rules/web-ui.md`.
- **Files:** `src/**` except `src/styles/**`, sourced from
  `main:apps/web/src/{main.tsx,router.tsx,queryClient.ts,queries.ts,api.ts,feeds.ts,lib/{html,time}.ts,routes/**,components/**,routeTree.gen.ts}`.
- **Edits:**
  - Skip `AuthMenu/**`, `ThreadSummary/**`, and `lib/sse.ts`. Remove `<AuthMenu/>` from `__root.tsx` and
    `<ThreadSummary/>` from `item.$id.tsx`.
  - `api.ts`: `apiFetch` → `fetch`; drop `fetchMe` and the enrichment calls.
  - `queries.ts`: drop `configQueryOptions`, `meQueryOptions`, `loadConfig`, and the `__config.json` comment.
  - Point `@yahn/schema` imports at the relative `shared/schema/index.js`.
  - Regenerate `routeTree.gen.ts` with one `vite build`.
- **Check:** `pnpm verify && ! grep -rnE "cdk-core|AuthMenu|ThreadSummary|apiFetch|@yahn/|__config" src && git diff --exit-code --stat -- src/routeTree.gen.ts`

### C9 · e2e green, under a minute (wave 3)
- **Agent:** implementer → verifier. A spec may change only where it contradicts PRE-PLAN §6 or
  `docs/hn-api.md`, and only after the implementer asks and the manager agrees.
- **Read first:** `.claude/rules/testing.md`, `.claude/rules/web-ui.md`.
- **Files:** whatever in `src/**`, `server/**`, or `e2e/fixtures/hn/*` a failing spec implicates.
- **Edits:** Run `pnpm e2e` and fix until green. If a run exceeds 60s, fix the cause (slow waits, a live
  call), never the timeouts.
- **Check:** `for i in 1 2 3; do /usr/bin/time -f %e -o /tmp/e2e.t env CI=1 pnpm e2e || exit 1; awk '$1>=60{exit 1}' /tmp/e2e.t || exit 1; done`

### C10 · `vercel.json` and CI (wave 4)
- **Agent:** implementer → verifier, with R1's answer pasted in by the manager.
- **Read first:** `.claude/rules/vercel.md`, `.claude/rules/testing.md`.
- **Files:** `vercel.json`, `.github/workflows/{ci,claude,preview-smoke}.yml`.
- **Edits:**
  - `vercel.json`: exactly as in §1.
  - `ci.yml`: main's minus the `pr-preview.yml` comment. Steps: install → `pnpm verify` →
    `playwright install --with-deps chromium` → `pnpm e2e`.
  - `claude.yml`: verbatim from main.
  - `preview-smoke.yml`: `on: deployment_status` with `state == 'success'`, non-Production environments
    only. It runs `PLAYWRIGHT_BASE_URL=<target_url> pnpm e2e --grep @smoke` with
    `secrets.VERCEL_AUTOMATION_BYPASS_SECRET`.
- **R1 answer (G1, cited in the researcher's report):** the GitHub integration emits `deployment_status`
  by default (vercel.com/docs/git/vercel-for-github; Vercel now also offers `repository_dispatch`, which we
  do not use). Success is `state == 'success'`. Vercel's example reads the URL from
  `deployment_status.environment_url`. The exact `deployment.environment` string is undocumented, so filter
  with `!contains(github.event.deployment.environment, 'Production')` and use
  `environment_url || target_url`. `VERCEL_AUTOMATION_BYPASS_SECRET`, `x-vercel-protection-bypass`, and
  `x-vercel-set-bypass-cookie: true` are current
  (vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).
  The docs say nothing on whether the bypass header affects caching, so §6 item 3 stays the empirical test.
- **Amended in wave 4:** main's `ci.yml` runs `on: pull_request` only, which would make §6 item 6 ("CI on
  `main` is green after the merge") impossible. `ci.yml` therefore also runs on `push` to `main`.
- **Check:** `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))" && grep -q deployment_status .github/workflows/preview-smoke.yml && grep -q 'pnpm verify' .github/workflows/ci.yml && ! ls .github/workflows | grep -qE 'deploy|pr-preview|teardown|cleanup'`

### C11 · Context refresh and README (wave 4)
- **Agent:** implementer → verifier.
- **Read first:** `CLAUDE.md` and all of `.claude/rules/`.
- **Files:** `CLAUDE.md`, `.claude/rules/*.md`, `README.md`.
- **Edits:** Make every claim match the merged code: paths, scripts, the fixture workflow, and what is
  deferred. `README.md` ≤40 lines covering `pnpm dev`, `pnpm e2e`, `pnpm hn:record`, and deploy.
- **Check:** `grep -ohE '\`(src|server|shared|api|e2e|scripts|docs)/[A-Za-z0-9_./$-]+\`' CLAUDE.md .claude/rules/*.md | tr -d '\`' | sort -u | while read p; do test -e "$p" || echo "MISSING $p"; done | grep -c MISSING | grep -qx 0 && test $(wc -l < CLAUDE.md) -lt 100`

### M1–M3 · Manager-only steps (each needs the user's OK first)
- **M1 — Vercel project (A2):** Run `vercel project add yahn`, `vercel link --project yahn --yes`, and
  `vercel git connect`. Confirm Node 24.x and protection = all deployments (U1). Create a Protection Bypass
  for Automation, then `gh secret set VERCEL_AUTOMATION_BYPASS_SECRET`. No env vars are needed. **Check:**
  `vercel project inspect yahn` shows Node 24.x and the repo.
- **Amended at M1:** `vercel project add` created the project with framework preset **Other**, whose output
  directory is `public`. The spike project had preset **Vite**. M1 therefore also runs
  `vercel project update yahn --framework vite`, which serves `dist/` and builds with `pnpm build`. The
  bypass secret is read from `vercel project protection yahn --json` (`protectionBypass` key with
  `scope: automation-bypass`). `vercel link` also wrote `.env.local` and added `.env*` to `.gitignore`.
- **M2 — History join and PR (A1).** Merge, `git push -u origin vercel`, `gh pr create --base main`. Wait for
  `CI` and `preview-smoke`. **Check:** `gh pr checks` is all green, with CI under 3 minutes.
- **Amended at M2:** the project's first Git deployment, the `vercel` push, was deployed as **Production**
  because no production deployment existed yet. So its GitHub deployment has `environment: "Production"`,
  and `preview-smoke` correctly skipped it. A second push to `vercel` produces the first real preview. The
  production alias is `https://yahn-chi.vercel.app`, since `yahn.vercel.app` is taken, so §6's `P` is that
  URL.
- **M3 — Production.** The user merges and a verifier runs §6. Then ask about `vercel project rm yahn-spike`.

## 5. Deferred

- **Epoch 2:** spikes S3/S4; `server/store` (memory + Upstash); port `server/enrich` and the model seam;
  job routes and SSE (force `no-store` over `streamSSE`'s `no-cache`); job schemas and `enrich-stream.ts`;
  `lib/sse.ts` and `ThreadSummary` on the job model; `/items/:id/enrichments`; spend caps; `summary.spec.ts`;
  `ai-jobs.md`; the Anthropic SSE replay vitest.
- **Epoch 3:** S5; `yahn.ty.ler.dev` cutover (confirm protection covers the custom domain); AWS teardown
  per PRE-PLAN §11; article summary.

## 6. Exit criterion (PRE-PLAN §9, made checkable)

`P=https://<project>.vercel.app` (from M3). `H="x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"`,
with the secret exported for the verifier by the manager.

1. `curl -sS -H "$H" $P/api/health | grep -q '"ok":true'`
2. `PLAYWRIGHT_BASE_URL=$P pnpm e2e:live` passes: six feeds, a thread with collapse, a user page, and
   search, all from live HN.
3. `for i in 1 2; do curl -sSI -H "$H" $P/api/v1/feeds/top | grep -i x-vercel-cache; done` prints `HIT` or
   `STALE` on the second line. If R1 says the bypass header defeats caching, recheck through a Shareable
   Link.
4. `curl -sS -H "$H" $P/item/1 | grep -q 'id="root"'`, and
   `curl -sS -H "$H" -o /dev/null -w '%{http_code}' $P/api/v1/nope` prints `404`.
5. `pnpm verify` exits 0, and C9's check passes (three `CI=1 pnpm e2e` runs, each under 60s).
6. `gh pr checks <PR>` was green before the merge, and `CI` on `main` is green after it.
7. The C2 and C11 checks pass (CLAUDE.md under 100 lines, five rules of at most 120 lines each).
8. `git grep -nE 'cdk-core|@aws-sdk|cognito' -- . ':!docs' ':!PRE-PLAN.md' ':!PLAN.md'` prints nothing.
