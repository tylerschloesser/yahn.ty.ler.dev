import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

/**
 * The enrichment API — a **second** Hono app behind a **second** Lambda, on a
 * **second** CloudFront behavior. It is separate from `createApp()` for two
 * reasons that are both properties of infrastructure rather than of taste:
 *
 * - Response streaming is an invoke-mode property of a Lambda function URL and
 *   is fixed at creation, so a streaming route cannot live behind the read
 *   API's buffered URL.
 * - Read responses are cached hard at the edge and these must not be cached at
 *   all, and caching is a property of a CloudFront behavior.
 *
 * `apps/api/src/lambda-enrich.ts` wraps it with `streamHandle`; `server.ts`
 * serves it on its own local port. Mounting it into the read app with
 * `app.route()` would silently drop that app's `onError` mapping, which is a
 * contract — see `.claude/rules/api.md`.
 */
export function createEnrichApp(): Hono {
  const app = new Hono()

  app.get('/api/v1/enrich/health', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  /**
   * **Spike, not the feature.** Hardcoded events on a timer, answering the one
   * question every other decision in this epoch depends on: does
   * `streamHandle` → `RESPONSE_STREAM` function URL → CloudFront actually
   * deliver bytes incrementally, or does something in that chain buffer the
   * whole body? There is no streaming prior art in this repo or in
   * thai.ler.dev, so it is proven before anything is built on it.
   *
   * Registered on GET *and* POST on purpose. Under origin access control
   * CloudFront signs each origin request with SigV4, and a request with a body
   * additionally needs the viewer to supply `x-amz-content-sha256` — so
   * whether this endpoint can take a body at all is a thing to measure through
   * a deployed edge, not to assume.
   *
   * The second path is the same handler behind the temporary `compress: true`
   * behavior. CloudFront does not rewrite the URI on the way to the origin, so
   * the origin has to answer both paths for one deploy to measure both.
   *
   * `t` is the server clock at write time; `curl -N` with per-line timestamps
   * compares it against arrival.
   */
  app.on(['GET', 'POST'], ['/api/v1/enrich/spike', '/api/v1/spike-compressed/spike'], (c) =>
    streamSSE(c, async (stream) => {
      const started = Date.now()
      await stream.writeSSE({ event: 'start', data: JSON.stringify({ t: started }) })

      for (let i = 0; i < 8; i++) {
        await stream.sleep(500)
        await stream.writeSSE({
          event: 'tick',
          id: String(i),
          data: JSON.stringify({ i, t: Date.now(), elapsed: Date.now() - started }),
        })
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ elapsed: Date.now() - started }),
      })
    }),
  )

  return app
}
