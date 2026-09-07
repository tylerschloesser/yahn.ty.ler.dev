import { getItem, NotFoundError, UpstreamError } from '@yahn/hn'
import {
  ENRICH_EVENT,
  type EnrichmentKind,
  type Enrichments,
  type ThreadSummary,
} from '@yahn/schema'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { SSEStreamingApi } from 'hono/streaming'
import { getModel } from './model/index.ts'
import { getStore } from './store.ts'
import { inputKey, renderThread, type SelectionStrategy } from './thread.ts'

/**
 * The enrichment API — a **second** Hono app behind a **second** Lambda on a
 * **second** CloudFront behavior. The split is forced, not stylistic:
 *
 * - Response streaming is an invoke-mode property of a Lambda function URL and
 *   is fixed at creation, so a streaming route cannot live behind the read
 *   API's buffered URL.
 * - Read responses are cached hard at the edge and these must not be cached at
 *   all, and caching is a property of a behavior.
 *
 * `src/lambda-enrich.ts` wraps it with `streamHandle`; `src/server.ts` serves
 * it on its own local port. Mounting it into the read app with `app.route()`
 * would silently drop that app's `onError` mapping, which is a contract — see
 * `.claude/rules/api.md`.
 */

const KIND: EnrichmentKind = 'thread-summary'

/**
 * Which slice of the thread goes to the model. Overridable per request purely
 * so the whole-tree-versus-a-selection question stays measurable against a
 * deployed edge without a redeploy; the default is what production serves.
 */
const DEFAULT_STRATEGY: SelectionStrategy = 'budget'

const STRATEGIES = new Set<string>(['full', 'top-level', 'budget'])

/**
 * How much of a large thread `budget` sends. Measured, not chosen by feel.
 *
 * It is a cap, not a target: an ordinary thread goes to the model whole (item
 * 8863's entire tree is 26k chars) and this binds only on the largest threads
 * on HN. On a 1,622-node thread it sends 670 comments for $0.37, against
 * $0.85 for the whole tree — and the summaries differ only in that a *smaller*
 * budget starts losing whole disagreements, which live in deep reply chains
 * and are what a breadth-first walk truncates first. Above 200k nothing new
 * appeared for another $0.47. Full table in `.claude/rules/api.md`.
 *
 * `?strategy=` and `?budget=` exist so that measurement can be re-run against
 * a deployed edge without a redeploy, which is the standard `CLAUDE.md` sets
 * for a claim a rule file asserts.
 */
const DEFAULT_BUDGET_CHARS = 200_000

export function createEnrichApp(): Hono {
  const app = new Hono()

  app.get('/events/v1/enrich/health', (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json({ ok: true })
  })

  /**
   * `GET`, not `POST`, and that is measured rather than stylistic: under
   * origin access control CloudFront signs the origin request with SigV4,
   * whose signature covers a payload hash CloudFront cannot compute — so a
   * POST *with a body* 403s unless the viewer sends `x-amz-content-sha256`
   * itself. Everything this needs is an item id, which fits in the path. The
   * result table is in `.claude/rules/cdk.md`.
   */
  app.get('/events/v1/enrich/thread/:id', (c) => {
    const id = Number(c.req.param('id'))
    const strategyParam = c.req.query('strategy')
    const budgetParam = Number(c.req.query('budget'))
    const strategy =
      strategyParam && STRATEGIES.has(strategyParam)
        ? (strategyParam as SelectionStrategy)
        : DEFAULT_STRATEGY

    c.header('Cache-Control', 'no-store')

    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: 'id must be a positive integer' }, 400)
    }

    const budgetChars =
      Number.isInteger(budgetParam) && budgetParam > 0 ? budgetParam : DEFAULT_BUDGET_CHARS

    return streamSSE(c, (stream) => run(stream, id, strategy, budgetChars))
  })

  return app
}

/**
 * Serializes every write to one stream.
 *
 * Necessary because the heartbeat below fires on a timer while a delta write
 * may already be in flight, and two concurrent writers on the same
 * `TransformStream` can interleave a keepalive into the middle of an SSE
 * frame — which a client parses as a corrupt event rather than as two.
 */
interface Writer {
  send(event: string, data: unknown): Promise<void>
  /** An SSE comment line, which every client ignores. */
  ping(): Promise<void>
}

function writer(stream: SSEStreamingApi): Writer {
  let tail: Promise<unknown> = Promise.resolve()

  const queue = (task: () => Promise<unknown>): Promise<void> => {
    const next = tail.then(task, task)
    tail = next.catch(() => undefined)
    return next.then(() => undefined)
  }

  return {
    send: (event, data) => queue(() => stream.writeSSE({ event, data: JSON.stringify(data) })),
    ping: () => queue(() => stream.write(': keepalive\n\n')),
  }
}

/**
 * SSE comment lines, which every client ignores.
 *
 * They exist for CloudFront, not for the client: the origin `readTimeout` is
 * 60s and applies to the gap *between* packets as well as to the first byte,
 * so a producer that goes quiet for longer is cut off at the edge while the
 * Lambda keeps running. Two stretches of this handler can be silent for a
 * long time — fetching a large comment tree (measured at up to 27s on the
 * biggest thread on HN) and a model thinking before its first token — and the
 * first of those happens *before* there is anything to put in `meta`.
 */
const HEARTBEAT_MS = 15_000

/**
 * The read-through, in stream order.
 *
 * Errors are reported **in band**. Once `streamSSE` has written a status line
 * it cannot be changed, so a failure after the first byte can only be an
 * `error` event — which is why the contract says a client must treat "stream
 * ended with no terminal event" as a failure rather than as a short summary.
 */
async function run(
  stream: SSEStreamingApi,
  id: number,
  strategy: SelectionStrategy,
  budgetChars: number,
) {
  const out = writer(stream)
  const heartbeat = setInterval(() => void out.ping(), HEARTBEAT_MS)

  try {
    const item = await getItem(id)
    const rendered = renderThread(item.story, item.comments, { strategy, budgetChars })
    const key = inputKey(rendered.text)
    const store = getStore()

    const cached = await store.read({
      itemId: id,
      kind: KIND,
      inputKey: key,
      totalComments: rendered.totalComments,
      comments: rendered.comments,
    })

    const input = {
      strategy: rendered.strategy,
      comments: rendered.comments,
      totalComments: rendered.totalComments,
      chars: rendered.chars,
      inputTokens: cached?.input.inputTokens ?? null,
      outputTokens: cached?.input.outputTokens ?? null,
    }

    /**
     * Sent before any model work begins, and not merely for tidiness: it tells
     * the client whether to render a stored summary or watch one being
     * written, and it puts a byte on the wire immediately. CloudFront gives an
     * origin 60 seconds to produce the first byte, and a cold Lambda plus a
     * comment-tree fetch plus a model's first token is not reliably inside it.
     */
    await out.send(ENRICH_EVENT.meta, {
      itemId: id,
      cached: cached !== null,
      inputKey: key,
      input,
    })

    if (cached) {
      await complete(out, cached)
      return
    }

    const result = await getModel().summarize(rendered.text, (text) =>
      out.send(ENRICH_EVENT.delta, { text }),
    )

    const summary: ThreadSummary = {
      text: result.text,
      model: result.model,
      generatedAt: Math.floor(Date.now() / 1000),
      inputKey: key,
      input: {
        ...input,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    }

    // Written before the terminal event, so a client that saw `complete` knows
    // the next reader gets a hit. A write failure is still reported in band
    // rather than swallowed: the summary was generated and paid for, and
    // silently failing to store it would mean paying for it again every time.
    await store.put(id, KIND, summary)
    await complete(out, summary)
  } catch (error) {
    await out.send(ENRICH_EVENT.error, { error: message(error) })
  } finally {
    clearInterval(heartbeat)
  }
}

function complete(out: Writer, threadSummary: ThreadSummary): Promise<void> {
  // The payload is the `enrichments` slot itself — the shape `Story.enrichments`
  // already declares — so the client merges it into the story it holds rather
  // than learning a second shape for the same thing.
  const enrichments: Enrichments = { threadSummary }
  return out.send(ENRICH_EVENT.complete, { enrichments })
}

/**
 * The same distinction the read API draws, carried into a stream that can no
 * longer express it as a status code: a missing item is the caller's problem
 * and an upstream failure is not ours.
 */
function message(error: unknown): string {
  if (error instanceof NotFoundError) return error.message
  if (error instanceof UpstreamError) {
    console.error('upstream failure', error.message, error.cause)
    return 'upstream request failed'
  }
  console.error('enrichment failed', error)
  return 'enrichment failed'
}
