# Vercel Hosting Research: Vite SPA + JSON API (as of Sept 2026)

Scope: hosting, functions, caching, deployment. Job/queue/storage for the AI summarization work is covered separately. All URLs are `vercel.com/docs` or `vercel.com/changelog` unless noted; "last_updated" dates below are as shown on the docs page itself when fetched on 2026-09-13.

## 1. Project shape

**Verdict:** Either layout works; for a small HN-clone API, a single Hono app (`api/index.ts` or root `server.ts`) is simpler than many `api/*.ts` files, and Hono-on-Vercel is an officially documented, zero-config integration. A catch-all SPA rewrite is safe — Vercel always resolves real files/functions before applying `rewrites`.

- Vercel's Vite doc says: if not using a framework with native function support, add Nitro, **or** just drop files in `/api` using the plain Node.js runtime docs (`api/hello.ts` exporting `fetch(request)` or `GET`/`POST`). ([Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite))
- Hono is explicitly documented: create `app.ts`/`index.ts`/`server.ts` (or `src/` equivalents) exporting a default Hono app; Vercel auto-detects it, and "your server routes automatically become Vercel Functions and use Fluid compute by default." No `vercel.json` needed for this. Streaming works via Hono's `stream()` helper. `vc dev` runs the same exported app locally. ([Hono on Vercel](https://vercel.com/docs/frameworks/backend/hono), [Deploy Hono backends with zero configuration](https://vercel.com/changelog/deploy-hono-backends-with-zero-configuration))
- SPA rewrite needed in `vercel.json`:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
  ([Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite))
- Rewrites **cannot** shadow `/api`: "precedence is given to the filesystem prior to rewrites being applied" — an existing static file or Function always wins over a matching rewrite. So the catch-all `/(.*)` → `/index.html` rule is safe as-is; you do not need a separate `/api/(.*)` exclusion rule. ([vercel.json reference](https://vercel.com/docs/project-configuration/vercel-json))
- The Vite framework preset is **not required** for `/api` to work — Functions are detected independently of the frontend build preset. The preset just supplies default build/output settings for Vite itself.
- Limits: bundle size 250MB uncompressed (500MB for Python; up to 5GB via beta "Large functions," Node/Bun/Python only, requires Fluid compute + Active CPU). Functions-per-deployment: Hobby is "framework-dependent" (docs no longer state a fixed number like the old "12" limit that shows up in older community threads), Pro/Enterprise unlimited (∞). Request/response body cap 4.5MB. ([Functions Limits](https://vercel.com/docs/functions/limitations), [Limits](https://vercel.com/docs/limits))
- Node.js runtime versions currently offered: 24.x (default for new projects), 22.x, 20.x — **Node 20 is being disabled in Project Settings on October 1, 2026**, i.e. right after this document's date; pin `engines`/project settings to 22 or 24. ([Node.js 20 is being deprecated](https://vercel.com/changelog/node-js-20-is-being-deprecated), [Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js))
- `@vercel/node` is largely invisible now — the zero-config model (`export default { fetch }` / named `GET`/`POST` exports, or Hono) doesn't require importing it directly except for the legacy `(req, res)` handler style, where `VercelRequest`/`VercelResponse` types come from `@vercel/node`.

## 2. Fluid compute and function limits

**Verdict:** Fluid compute is on by default; default `maxDuration` is 300s on every plan, which already comfortably covers a 10–60s AI job started synchronously. Web-standard `Request`/`Response` is the native signature now; streaming and `waitUntil` are supported, but both are still bounded by `maxDuration`.

- Defaults/max (Fluid compute, GA): Hobby 300s default **and** max (fixed). Pro/Enterprise: 300s default, 800s max (GA), 1800s (30 min) extended-max in beta for `nodejs20.x/22.x/24.x`, Bun `1.x`/`1.4.x`, `python3.12–3.14` only, configured per-function (not project-wide yet). ([Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration), [Functions Limits](https://vercel.com/docs/functions/limitations))
- Set duration via `export const maxDuration = 30` (Next.js App Router style) or `export const config = { maxDuration: 30 }` (pages/other-framework `/api` files), or in `vercel.json`:
  ```json
  { "functions": { "api/*.ts": { "maxDuration": 60 } } }
  ```
  ([Configuring Maximum Duration](https://vercel.com/docs/functions/configuring-functions/duration))
- Memory: Hobby fixed 2GB/1vCPU; Pro/Enterprise default 2GB/1vCPU, configurable up to 4GB/2vCPU. ([Functions Limits](https://vercel.com/docs/functions/limitations))
- The June 25, 2025 changelog raised these defaults platform-wide (from 60–90s to 300s default, 90s→800s Pro max) and moved billing to Active CPU time; current docs (last_updated Aug 2026) confirm these are still the live numbers. ([Higher defaults and limits for Vercel Functions running Fluid compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute))
- Streaming: native — return a Web `Response` with a `ReadableStream`/SSE (`Content-Type: text/event-stream`); Vercel recommends the AI SDK's `streamText().toTextStreamResponse()`. Node.js and Python runtimes both stream. ([Streaming](https://vercel.com/docs/functions/streaming-functions))
- `waitUntil` (from `@vercel/functions`) extends the invocation only for the *same* `maxDuration` — "promises passed to `waitUntil()` will have the same timeout as the function itself... If the function times out, the promises will be cancelled." It is not a way to run longer than `maxDuration`; for genuinely long jobs Vercel points to **Vercel Workflows** (pause/resume, no duration cap) instead. `getDeadline()` lets code check the invocation's hard deadline. ([@vercel/functions API Reference](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package))
- Function signature: Web-standard `fetch(request: Request): Response` or named `GET`/`POST` exports are the current idiomatic form; the classic Node `(request, response)` style with `VercelRequest`/`VercelResponse` helpers (`.query`, `.cookies`, `.body`, `.status().json()`) is still fully supported. ([Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js))
- Regions: default `iad1` (Washington DC) for all new projects. Hobby = single region only; Pro = up to 5 regions; Enterprise = all + failover. Set via `vercel.json` `"regions": ["sfo1"]`, dashboard, `vercel --regions sfo1`, or per-function overrides in `functions`. ([Configuring regions](https://vercel.com/docs/functions/configuring-functions/region))

## 3. CDN caching

**Verdict:** Full control is available via three layered headers; caching is keyed by method+URL+host+deployment (query strings included for dynamic responses); only whitelisted status codes are ever cached; invalidation is tag-based, not manual-URL-based; streaming responses are cacheable up to 20MB.

- Header priority (highest wins): `Vercel-CDN-Cache-Control` (Vercel only, stripped before reaching client/other CDNs) > `CDN-Cache-Control` (Vercel + downstream CDNs, stripped before browser) > `Cache-Control` (web-standard, reaches the browser). If you set only `Cache-Control` with `s-maxage`, Vercel strips `s-maxage`/`stale-while-revalidate` before forwarding to the browser. Recommended triple-header pattern for full control:
  ```
  Cache-Control: public, max-age=10
  CDN-Cache-Control: public, max-age=60
  Vercel-CDN-Cache-Control: public, max-age=3600
  ```
  ([Cache-Control headers](https://vercel.com/docs/caching/cache-control-headers), [CDN Cache](https://vercel.com/docs/caching/cdn-cache))
- `s-maxage`: fresh window, min 1s / max 1 year. `stale-while-revalidate`: serves stale instantly, revalidates in background. `stale-if-error` also supported. `proxy-revalidate` is **not** supported. ([Cache-Control headers](https://vercel.com/docs/caching/cache-control-headers))
- Cache key = request method + request URL (query strings count for dynamic/function responses — "ignored for static files" only) + host + unique deployment URL + scheme. Not configurable directly; add request headers to the key with the `Vary` header (Accept/Accept-Encoding already included by default). ([Purging Vercel CDN Cache](https://vercel.com/docs/caching/cdn-cache/purge), [CDN Cache — Vary header](https://vercel.com/docs/caching/cdn-cache#vary-header))
- Non-2xx caching: by design, only `200, 404, 410, 301, 302, 307, 308` are cacheable at all — a 4xx/5xx response is never CDN-cached even with `s-maxage` set. Also excluded: responses with `set-cookie`, `private`/`no-cache`/`no-store`, `Vary: *`, `Range`/`Authorization` on the request, or >10MB (non-streaming) / >20MB (streaming). ([CDN Cache — cacheable response criteria](https://vercel.com/docs/caching/cdn-cache#cacheable-response-criteria))
- Invalidation is tag-based, not path-based: set `Vercel-Cache-Tag: tag1,tag2` header or call `addCacheTag()` from `@vercel/functions`, then purge with `invalidateByTag()` (background revalidation, recommended) or `dangerouslyDeleteByTag()` (foreground, stampede risk) — available from code, Vercel CLI (`vercel cache invalidate --tag`), REST API, or the dashboard. Purging by tag clears CDN cache, Runtime Cache, and Data Cache together. Limits: 128 tags/response, 256 bytes/tag. ([Purging Vercel CDN Cache](https://vercel.com/docs/caching/cdn-cache/purge))
- Region scope: "Vercel's CDN Cache is segmented by region" — i.e. per-region, not a single global cache; `expireTag` on the separate Runtime Cache API propagates globally within ~300ms. ([CDN Cache — Limits](https://vercel.com/docs/caching/cdn-cache#limits))
- Streaming responses are cacheable (max 20MB vs 10MB for non-streaming) — useful if you ever cache a finished/deterministic AI summary response, though most streamed LLM output for a specific request should probably be `no-store`.

## 4. Preview deployments and GitHub integration

**Verdict:** Every push gets a unique preview URL plus a stable per-branch URL; env vars are scoped per environment (and per-branch within Preview); Password Protection needs Pro, but Hobby's free Vercel Authentication + a bypass secret is enough to run Playwright against protected previews from CI.

- URL shapes: unique-per-deployment `project-<hash>-<team>.vercel.app`, and a stable per-branch alias `project-git-<branch>-<team>.vercel.app`. The GitHub App comments the PR with the URL automatically. ([Deploying GitHub Projects with Vercel](https://vercel.com/docs/git/vercel-for-github))
- Env var scoping: Production / Preview / Development are separate targets; you can give the same variable name a different value per target, and further scope a Preview value to one specific branch (branch-specific overrides beat the general Preview value). To keep a secret **out** of Preview entirely, just don't check the Preview target when adding it — it's simply absent from preview builds; to use a different (sandbox) value in Preview, add the same key targeted only at Preview with a different value. ([Environment Variables](https://vercel.com/docs/environment-variables))
- Deployment Protection by plan: Hobby gets Vercel Authentication (SSO-gated for team members) + Deployment Protection Exceptions + Shareable Links, all free. Password Protection is Pro-only, $20/month **per protected project** add-on (not on Hobby). ([Deployment Protection on Vercel](https://vercel.com/docs/deployment-protection), [Hobby Plan](https://vercel.com/docs/plans/hobby))
- Running Playwright from GitHub Actions against a protected preview: generate a secret under Project Settings → Deployment Protection → **Protection Bypass for Automation**; Vercel also auto-injects it as `VERCEL_AUTOMATION_BYPASS_SECRET`. Send it as header `x-vercel-protection-bypass: <secret>` (recommended) or query param; add `x-vercel-set-bypass-cookie: 'true'` on the first request so the whole browser context stays authorized for follow-up navigations. Documented Playwright config:
  ```ts
  export default defineConfig({
    use: { extraHTTPHeaders: {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-vercel-set-bypass-cookie': 'true',
    }},
  });
  ```
  Obtaining the URL itself in CI: `vercel pull --environment=preview`, `vercel build`, `vercel deploy --prebuilt` (prints the URL), or a GitHub Action like `zentered/vercel-preview-url`. ([Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation))

## 5. Local development

**Verdict:** `vercel dev` works but is reported as noticeably slower/quirkier when layered on top of the Vite dev server (extra request hops, SPA-rewrite conflicts); for a Hono API the cleanest and fastest local loop is running the same Hono app via `@hono/node-server` on its own port with a Vite dev-server proxy — this is also what a Playwright suite that boots its own servers wants.

- `vercel dev` behavior: it links a project, reads `vercel.json`, and emulates the production routing/Functions layer locally, proxying the framework's own dev server underneath. For Hono specifically Vercel's own docs say just run `vc dev` and it uses the exported app "the same as when deployed." ([Hono on Vercel — Local development](https://vercel.com/docs/frameworks/backend/hono))
- Known pain points: a long-standing GitHub issue reports `vercel dev` + Vite as "incredibly slow" with request waterfalls/added latency on every proxied request; community threads note the SPA catch-all rewrite in `vercel.json` breaks Vite's own dev server routing, with the workaround being a separate `vercel-dev.json` that clears the rewrite for local use. ([vercel/vercel#10852](https://github.com/vercel/vercel/issues/10852), [Vercel Community — SPA routing and API dev conflicts](https://community.vercel.com/t/trouble-with-vite-react-vercel-spa-routing-and-api-dev-conflicts/16896))
- Alternatives:
  - **`@hono/node-server` + Vite proxy** (recommended): run the identical Hono `app.ts` export under Node's HTTP server on e.g. `:8787`, and configure `vite.config.ts`'s `server.proxy` to forward `/api` to that port. Zero emulation overhead, instant restarts, no dependency on Vercel's Lambda-emulation layer, and the same app file deploys unchanged to Vercel Functions.
  - **`@hono/vite-dev-server`**: official Hono Vite plugin that runs the Hono app inside Vite's own dev server process (single process, single port) — good DX but couples dev-server internals to Hono in a way that's less transparent for a Playwright global-setup script that just wants "start server, wait for port, run tests."
  - **`vite-plugin-vercel`**: third-party plugin that emulates more of Vercel's build/routing inside Vite; useful if you want `vercel dev`-like fidelity without its slowness, but it's community-maintained, not a first-party Vercel product.
- **Recommendation**: for a Playwright suite that boots its own servers, use `@hono/node-server` on a fixed port + `concurrently`/`start-server-and-test` to launch it alongside `vite dev` (proxying `/api`), or `vite preview` for a closer-to-prod build check. This avoids `vercel dev`'s startup/link requirement and observed latency, and keeps the same Hono app file as the single source of truth for both local and deployed behavior.

## 6. Pricing awareness

**Verdict:** Hobby is fine for personal, non-commercial use and has generous headroom for a low-traffic HN clone; commercial use requires Pro ($20/user/month + usage).

- Hobby is explicitly restricted: "the Hobby plan restricts users to non-commercial, personal use only" per the fair-use guidelines. ([Hobby Plan](https://vercel.com/docs/plans/hobby))
- Hobby included usage: 1,000,000 Function Invocations, 4 Active-CPU-hours, 360 GB-hours Provisioned Memory, up to 1,000,000 Edge Requests, 200 projects, 100 deployments/day, 1 hour of runtime logs. ([Hobby Plan](https://vercel.com/docs/plans/hobby))
- Pro: same Function duration/memory ceilings raised (800s/1800s beta, 4GB/2vCPU), 10M Edge Requests included then on-demand billing (~$0.60/1M invocations, ~$0.128/hr Active CPU, ~$0.0106/GB-hr Provisioned Memory beyond included), unlimited projects, 1 day of runtime logs, Password Protection add-on, team RBAC. ([Hobby Plan comparison table](https://vercel.com/docs/plans/hobby), [Limits](https://vercel.com/docs/limits))
- For a solo, non-commercial HN clone, Hobby's limits are unlikely to bind unless the AI summarization jobs run at real volume — active-CPU-hours (4/month included) is the number to watch if summarization calls become frequent, since active CPU excludes I/O wait but each request still consumes some.

## 7. Monorepo

**Verdict:** A pnpm workspace monorepo is well supported (native detection, filtered installs, build-skipping for unaffected apps), but for a solo developer a single package is simpler and removes an entire class of Root-Directory/build-skip configuration to get right. Recommendation: start single-package; only split into a monorepo if `packages/*` shared code actually needs its own versioned boundary.

- Vercel natively supports npm/yarn/pnpm/Bun workspaces. Each deployable app becomes its own Vercel **Project** with its own Root Directory pointed at, e.g., `apps/web`. ([Using Monorepos](https://vercel.com/docs/monorepos))
- Root Directory: set per-project (not at the monorepo root) via dashboard or `vercel link --repo` from the CLI; setting Root Directory to the monorepo root itself is explicitly discouraged because it forces every app to rebuild on every change. ([Using Monorepos](https://vercel.com/docs/monorepos))
- Vercel auto-skips builds for unaffected workspace packages (detects unique `name` fields, explicit inter-package deps, and lockfile scoping) — this is free and doesn't consume a build/concurrency slot, unlike a manual Ignored Build Step script for repos that don't meet the auto-skip requirements.
- Filtered installs speed up CI, e.g. `"installCommand": "pnpm install --filter web..."` in `apps/web/vercel.json`.
- `includeFiles`/`excludeFiles` (Node.js runtime only) are set per-function under `vercel.json`'s `functions` config to control what non-code assets get bundled into a Function — relevant mainly if a shared `packages/*` module ships data files the API needs at runtime.
- Given this project is a single SPA + one small API for one developer, a **single package repo** (Vite app at the root, Hono app in `/api`) avoids: two Vercel Projects to keep in sync, Root Directory misconfiguration risk, workspace-hoisting edge cases, and the auto-skip requirements (unique package names, explicit deps) that only pay off once you have several independently-deployed apps.

## Recommendations

1. Single Vercel Project, single package (no monorepo) — Vite SPA at the root, Hono app exported from `api/index.ts` (or `server.ts`) — simplest path that's still officially zero-config on Vercel.
2. Use Hono as the API layer specifically because the same exported app runs locally under `@hono/node-server` and in prod as a Vercel Function with no rewrite.
3. `vercel.json` needs only the SPA catch-all rewrite; filesystem/Functions precedence means `/api` is never swallowed by it.
4. Pin the Node.js runtime to 22.x or 24.x now — Node 20 stops being selectable on Vercel October 1, 2026.
5. Rely on Fluid compute's 300s default `maxDuration` for the AI summarization endpoint rather than raising it; if a job could exceed ~250–280s, prefer Vercel Workflows over stretching `maxDuration`/`waitUntil`.
6. Use the triple Cache-Control header pattern (`Cache-Control` / `CDN-Cache-Control` / `Vercel-CDN-Cache-Control`) plus cache tags for the HN proxy endpoints (`/api/v1/feeds/top`, `/api/v1/items/:id`) so you can invalidate on demand instead of waiting out a TTL.
7. Local dev loop: `@hono/node-server` on a fixed port + Vite dev server proxying `/api`, started together for Playwright's global setup — skip `vercel dev` for the day-to-day loop given its reported Vite-proxy latency and SPA-rewrite friction.
8. Stay on Hobby while the project is personal/non-commercial; watch Active-CPU-hours (4/month included) as the first likely thing to exceed once AI summarization traffic grows.
9. For CI E2E: generate a Protection Bypass for Automation secret, feed it to Playwright via `extraHTTPHeaders` + `x-vercel-set-bypass-cookie`, no need for Password Protection (Pro add-on) on a solo project.
10. Scope any Anthropic API key etc. to Production only (or give Preview a distinct low-limit key) via per-environment env var targeting, rather than sharing the production secret with every PR preview.

## Open questions / risks

- The exact current Hobby "Functions Created per Deployment" cap is documented as "framework-dependent" with a link to a runtimes page rather than a fixed number — worth re-checking that page directly before finalizing an API file count, in case a raw `/api/*.ts` layout (vs. one Hono catch-all) approaches an undocumented ceiling.
- Extended `maxDuration` beyond 800s is still in **beta** and requires per-function (not project-level) configuration — don't design the AI job around it as a stable primitive yet.
- CDN cache is per-region, so a purge/invalidate needs to be tag-based (not "purge this URL") — confirm the job/storage agent's caching plan for AI summaries (if any) accounts for this rather than assuming a single global cache.
- Deployment Protection default (Vercel Authentication) also gates the **production** URL for team members other than the owner by default in some configurations — verify this doesn't unexpectedly block anonymous public users if this app is meant to be publicly browsable outside of previews.
- `vite-plugin-vercel` and `@hono/vite-dev-server` were only surfaced via search, not fetched from primary docs (they're third-party/Hono-team packages, not `vercel.com/docs`) — validate current versions/maintenance status before adopting either as more than a fallback option.
