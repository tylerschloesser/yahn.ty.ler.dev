---
paths:
  - "vercel.json"
  - ".github/workflows/**"
  - "server/dev.ts"
---

# Vercel hosting

Loaded when you touch `vercel.json`, a workflow, or the local dev server.

## Function entry (spike S1, verified on a throwaway project)

`api/index.ts` is `import { app } from '../server/app.js'; export default app` — the Hono app as
a plain Web `fetch` handler. **No `hono/vercel` adapter, no `[[...route]].ts` filename.**
`vercel.json` is exactly:

```json
{ "functions": { "api/index.ts": { "maxDuration": 300 } },
  "rewrites": [ { "source": "/api/(.*)", "destination": "/api" },
                { "source": "/(.*)", "destination": "/index.html" } ] }
```

**The `/api` rewrite is required and must come first.** Without it, the SPA catch-all served
`index.html` for `/api/health` instead of reaching the function. Once it is there, Hono sees the
original path, so literal `/api/v1/...` routes work unchanged — do not add a second rewrite per
route.

**Every relative import a function loads (`api/`, `server/`, `shared/`) needs a `.js`
specifier**, not `.ts`. Vercel transpiles file by file without rewriting specifiers, so `./x.ts`
builds and then crashes at runtime with `ERR_MODULE_NOT_FOUND`. A `.js` specifier resolves
correctly under `nodenext`, tsx, vitest, and Vite alike. **TypeScript errors do not fail a Vercel
build** — this is why `pnpm build` runs `pnpm typecheck` first; an import that only breaks at
runtime is otherwise invisible until the deploy.

**`lint:imports` is `! grep -rnsE "from '\.\.?/[^']*\.tsx?'" api server shared scripts | grep .`**
— the trailing `| grep .` is load-bearing. A bare `! grep -rns ...` exits 0 whenever one of those
four directories is missing (grep itself exits 2, and `!` negates that), so it would silently
pass real `.ts`-specifier violations instead of catching them.

Plan **Hobby**, region **iad1**, Node **24.x** (Vercel honours `engines.node`), function ceiling
**300s** — well inside it is `server/hn`'s worst measured case (6.5s), which was measured rather
than assumed because tail latency there is real (`.claude/rules/hn-data.md`).

## Env vars, this epoch

Only `HN_SOURCE` matters yet: unset (`live`) for `pnpm dev`, `fixture` for `pnpm dev:e2e` and the
`chromium` Playwright project. `MODEL_PROVIDER`, `STORE`, and the Redis/Upstash vars arrive with
the job routes in Epoch 2 — do not add them speculatively.

## Deployment Protection and the bypass header

**This account's default is Vercel Authentication on all deployments, production included** — a
plain `curl` gets a 302 to SSO. **Every remote check must send
`x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET`**; a Playwright run against a
deployed URL also needs `x-vercel-set-bypass-cookie: true` once, so the browser context carries a
cookie for subsequent navigations. `.claude/settings.json`'s allowlist has no `vercel --prod` and
no other destructive `vercel` command — deploys happen through the Git integration, never by hand.

## CDN, and how it differs from CloudFront

A repeat `GET` on an `s-maxage=60` route showed `x-vercel-cache: HIT`, but **the client only ever
sees `cache-control: public`** — Vercel strips `s-maxage`/`stale-while-revalidate` from what it
forwards downstream, unlike CloudFront, which passes origin headers through unchanged. Don't
"fix" a route that appears to serve no max-age to a client; check `x-vercel-cache` instead. An SSE
route streamed at 1 event/s was never cached, which is correct, but Hono's `streamSSE` overwrites
`Cache-Control` with `no-cache` even when the route should be `no-store` — an Epoch 2 problem for
the job-events route, not one to fix here. `Vercel-Cache-Tag` is set per `.claude/rules/api.md`
for a future on-demand purge; nothing calls the purge API in this epoch.

## `pnpm-workspace.yaml`

`vercel link` writes a settings-only `pnpm-workspace.yaml` (no `packages:` key), just so pnpm
will prompt `pnpm approve-builds` for esbuild. This does not make the repo a workspace — there is
still exactly one `package.json`, at the root.

## Project and CI

The Vercel project is `yahn`, Git-connected, deploying on every push with no manual `vercel`
command; the production branch is `main` (PLAN.md M1–M2). `ci.yml` (on pull requests and pushes to `main`) runs
`pnpm verify` then `pnpm e2e`. `preview-smoke.yml` (on `deployment_status`, `state == 'success'`,
non-Production environments only) runs `pnpm e2e --grep @smoke` against the deployment's own URL
with `VERCEL_AUTOMATION_BYPASS_SECRET` set, which is what makes `playwright.config.ts` add the
bypass header automatically.
