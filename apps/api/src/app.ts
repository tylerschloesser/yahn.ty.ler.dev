import { zValidator } from '@hono/zod-validator'
import { getAuthorItems, getFeed, getItem, getUser, search, NotFoundError, UpstreamError } from '@yahn/hn'
import { AuthorItemTypeSchema, FeedNameSchema, SearchSortSchema } from '@yahn/schema'
import { Hono } from 'hono'
import { z } from 'zod'
import { getUserId } from './auth.ts'

/**
 * The read API. It is deliberately thin: routing, validation, cache headers
 * and error mapping. Everything that could be wrong — the tree merge, sibling
 * ordering, node caps, tombstones — lives in `@yahn/hn`, where it is pure and
 * unit-tested without a server.
 *
 * `POST /api/v1/enrich/**` is reserved and built in a later epoch. It cannot
 * share this Lambda: enrichment streams (SSE), and response streaming is an
 * invoke-mode property of the Function URL that is fixed at creation. Nor can
 * it share a CloudFront behavior, since these responses are cached hard and
 * that one must not be cached at all. Reserving the prefix now is what makes
 * that split cheap later.
 */

type Variables = { userId: string | null }

/**
 * Cache-Control is where this Lambda earns its keep. CloudFront honors what
 * the origin sets, so a cached front page is one edge hit instead of 31 HN
 * requests. The numbers are short because HN reranks continuously;
 * `stale-while-revalidate` is what keeps a rerank from ever costing a viewer
 * the full origin latency.
 *
 * **Every handler sets its header after the upstream call resolves, never
 * before.** A header set first is still on the response when the call throws,
 * so a single HN blip would go out as a 502 carrying `max-age=30` and
 * CloudFront would cache the outage at every edge for thirty seconds and serve
 * it stale for another three hundred. `notFound` and `onError` below say
 * `no-store` for the same reason.
 */
const CACHE = {
  feed: 'public, max-age=30, stale-while-revalidate=300',
  item: 'public, max-age=60, stale-while-revalidate=300',
  user: 'public, max-age=300, stale-while-revalidate=600',
  search: 'public, max-age=60, stale-while-revalidate=300',
} as const

const PageSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
})

const IdSchema = z.object({
  id: z.coerce.number().int().positive(),
})

const AuthorItemsSchema = z.object({
  page: z.coerce.number().int().nonnegative().default(0),
  type: AuthorItemTypeSchema.default('all'),
})

const SearchSchema = z.object({
  q: z.string().min(1),
  // Algolia pages are 0-based, and `SearchResponse.page` documents them that
  // way, so this passes through rather than quietly shifting by one.
  page: z.coerce.number().int().nonnegative().default(0),
  sort: SearchSortSchema.default('relevance'),
})

/**
 * Every rejection has one shape — `{ error: string }` with a 400 — so a client
 * never has to branch on the body. Wrapping `zValidator` here rather than
 * repeating the hook keeps that true by construction.
 */
function validate<Target extends 'param' | 'query', Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return undefined
    c.header('Cache-Control', 'no-store')
    return c.json({ error: z.prettifyError(result.error) }, 400)
  })
}

export function createApp(): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>()

  // The auth seam, wired rather than decorative: every handler reads the
  // caller's identity from here and never from a header. It is `null` for now.
  app.use('*', async (c, next) => {
    c.set('userId', getUserId(c))
    await next()
  })

  app.get('/api/health', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  app.get(
    '/api/v1/feeds/:feed',
    validate('param', z.object({ feed: FeedNameSchema })),
    validate('query', PageSchema),
    async (c) => {
      const { feed } = c.req.valid('param')
      const { page } = c.req.valid('query')
      const body = await getFeed(feed, page)
      c.header('Cache-Control', CACHE.feed)
      return c.json(body)
    },
  )

  app.get(
    '/api/v1/items/:id',
    validate('param', IdSchema),
    async (c) => {
      const { id } = c.req.valid('param')
      const body = await getItem(id)
      c.header('Cache-Control', CACHE.item)
      return c.json(body)
    },
  )

  app.get('/api/v1/users/:id', async (c) => {
    const user = await getUser(c.req.param('id'))
    c.header('Cache-Control', CACHE.user)
    return c.json({ user })
  })

  app.get(
    '/api/v1/users/:id/items',
    validate('query', AuthorItemsSchema),
    async (c) => {
      const { page, type } = c.req.valid('query')
      const body = await getAuthorItems({ author: c.req.param('id'), type, page })
      c.header('Cache-Control', CACHE.user)
      return c.json(body)
    },
  )

  app.get(
    '/api/v1/search',
    validate('query', SearchSchema),
    async (c) => {
      const { q, page, sort } = c.req.valid('query')
      const body = await search({ query: q, page, sort })
      c.header('Cache-Control', CACHE.search)
      return c.json(body)
    },
  )

  app.notFound((c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ error: 'not found' }, 404)
  })

  /**
   * Upstream failure is not this API's failure. A `NotFoundError` means HN
   * says the item does not exist — Firebase answers that with `200 null`, so
   * turning it into a real 404 is this layer's job. Anything else from HN or
   * Algolia is a 502: the request was fine, the upstream was not, and a client
   * that sees 500 would reasonably blame us and stop retrying.
   */
  app.onError((error, c) => {
    c.header('Cache-Control', 'no-store')
    if (error instanceof NotFoundError) return c.json({ error: error.message }, 404)
    if (error instanceof UpstreamError) {
      console.error('upstream failure', error.message, error.cause)
      return c.json({ error: 'upstream request failed' }, 502)
    }
    console.error('unhandled error', error)
    return c.json({ error: 'internal error' }, 500)
  })

  return app
}
