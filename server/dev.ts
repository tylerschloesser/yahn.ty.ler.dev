import { serve } from '@hono/node-server'
import { app } from './app.js'
import { applyLocalDefaults, env } from './env.js'

/**
 * The local composition root. `api/index.ts` wraps the same `app`, so
 * `pnpm dev` and the deployed Vercel function run identical code — the only
 * difference is what calls `fetch` on it.
 *
 * A single server on one port: unlike the old Lambda split, there is no
 * enrichment app yet in this epoch, and no streaming route that would need
 * its own process.
 */
applyLocalDefaults()

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`)
})
