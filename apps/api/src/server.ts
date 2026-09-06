import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { createEnrichApp } from './enrich/app.ts'
import { applyLocalDefaults, env } from './env.ts'

/**
 * The local composition root. `src/lambda.ts` and `src/lambda-enrich.ts` wrap
 * these same two apps, so `pnpm dev` and production run identical code with
 * nothing mocked between them — the only difference is what calls `fetch`.
 *
 * Two ports rather than one mounted app, because production is two Lambdas
 * behind two CloudFront behaviors and that split is what makes streaming
 * possible at all. Mounting the read app into a parent with `app.route()`
 * would also drop its `onError` mapping, and that mapping is a contract — see
 * `.claude/rules/api.md`. Vite's dev proxy sends `/api/v1/enrich` here and
 * everything else to the read port, mirroring the two behaviors.
 *
 * Neither needs credentials or secrets: both HN APIs are public, and the model
 * provider defaults to `fake` outside Lambda. That property is what lets a
 * session verify its own work end to end before opening a PR, and it is the
 * main deviation from thai.ler.dev, which has no local backend and proxies
 * `/api` to production.
 */
applyLocalDefaults()

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})

serve({ fetch: createEnrichApp().fetch, port: env.enrichPort }, (info) => {
  console.log(`enrich api listening on http://localhost:${info.port}`)
})
