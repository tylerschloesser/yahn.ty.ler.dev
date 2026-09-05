import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { env } from './env.ts'

/**
 * The local composition root. `src/lambda.ts` wraps the same `createApp()`, so
 * `pnpm dev` and production run identical code with nothing mocked between
 * them — the only difference is what calls `fetch` on the app.
 *
 * It needs no credentials and no secrets: both HN APIs are public. That is the
 * property that lets a session verify its own work end to end before opening a
 * PR, and it is the main deviation from thai.ler.dev, which has no local
 * backend and proxies `/api` to production.
 */
serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
