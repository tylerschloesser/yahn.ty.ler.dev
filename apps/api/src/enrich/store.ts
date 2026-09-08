import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { ThreadSummarySchema, type EnrichmentKind, type ThreadSummary } from '@yahn/schema'
import { AWS_REGION, env } from '../env.ts'

/**
 * Where a generated enrichment lives so it is generated once.
 *
 * `pk=ITEM#<id>` / `sk=ENRICH#<kind>#<generatedAt>#<inputKey>`.
 *
 * **Both obvious ways to key this are wrong, in opposite directions**, and it
 * cost a live measurement to find out. The original plan said
 * `sk=ENRICH#<kind>#<contentKey>`, and a story's `contentKey` is
 * `sha256(url ?? text)` — fixed the moment it is posted, so it never
 * invalidates and the first summary of an empty thread would be served
 * forever. Hashing the model input instead fixes that and breaks the other
 * way: measured against a live front-page thread, **seven consecutive
 * requests produced seven distinct keys and seven paid generations.** HN
 * re-ranks continuously and comments keep arriving, so the exact bytes sent to
 * the model are never twice the same and the cache never hits at all — which
 * is precisely the "serve every later viewer from the table" this epoch
 * exists to do.
 *
 * So the key is still the input hash (a hit is then guaranteed to answer the
 * same question) but a *miss* falls back to the newest stored summary, which
 * is served when the thread has not grown much since — see `read()`. That
 * makes a thread which has stopped growing a permanent cache hit, which is
 * when almost all reads happen, while a thread still filling up regenerates
 * on a geometric schedule rather than per viewer.
 *
 * `generatedAt` sits in the sort key ahead of the hash so "newest first" is a
 * `ScanIndexForward: false` query rather than a scan.
 *
 * `STORE=memory` is what lets `pnpm dev` and `pnpm e2e` exercise the whole
 * read-through with no AWS account. `applyLocalDefaults()` sets it.
 */

export interface EnrichStore {
  /** The newest usable summary for this item, or `null` to generate one. */
  read(query: ReadQuery): Promise<ThreadSummary | null>
  put(itemId: number, kind: EnrichmentKind, summary: ThreadSummary): Promise<void>
}

export interface ReadQuery {
  itemId: number
  kind: EnrichmentKind
  /**
   * The key of the input we would send now. An exact match is always valid.
   * Omitted by the cheap pre-render check below, which has not rendered
   * anything yet and so cannot know it.
   */
  inputKey?: string
  /** Comments in the thread right now, to compare against what was summarized. */
  totalComments: number
  /**
   * Comments we would send now, so a thinner stored summary is not reused.
   * Omitted by the cheap pre-render check, which has to answer the coverage
   * half of the rule without rendering — `strategy`/`budgetChars` stand in
   * for it instead: two requests with identical selection parameters render
   * comparable coverage without either one having to render.
   */
  comments?: number
  /** With `budgetChars`, the coverage proxy used when `comments` is omitted. */
  strategy?: string
  budgetChars?: number
}

/**
 * How much a thread may grow before its stored summary is regenerated.
 *
 * A summary of 1,000 comments is not meaningfully wrong when there are 1,150,
 * and making this proportional rather than a fixed age is what gives the two
 * behaviours worth having: a finished thread is cached permanently however
 * long ago it was summarized, and a live one regenerates a handful of times as
 * it doubles rather than once per reader.
 */
const GROWTH_TOLERANCE = 0.15

/** A summary of a thread nobody has opened in a month is not worth storing. */
const TTL_SECONDS = 30 * 24 * 60 * 60

/** Enough to find an exact match among recent rows without an unbounded read. */
const READ_LIMIT = 10

function pk(itemId: number): string {
  return `ITEM#${itemId}`
}

function skPrefix(kind: EnrichmentKind): string {
  return `ENRICH#${kind}#`
}

/** Zero-padded so the sort key orders by time lexicographically. */
function sk(kind: EnrichmentKind, summary: ThreadSummary): string {
  return `${skPrefix(kind)}${String(summary.generatedAt).padStart(10, '0')}#${summary.inputKey}`
}

/**
 * The one place the read-through decides a stored summary is good enough, so
 * the rule is stated once and both backends obey it.
 */
function usable(candidates: ThreadSummary[], query: ReadQuery): ThreadSummary | null {
  if (query.inputKey !== undefined) {
    const exact = candidates.find((c) => c.inputKey === query.inputKey)
    if (exact) return exact
  }

  // Newest first. Two conditions, and both are needed.
  for (const candidate of candidates) {
    const was = candidate.input.totalComments
    if (was <= 0) continue

    // The thread has not meaningfully grown since this was written. On a
    // thread that has stopped growing this is always true, which is the case
    // that matters most — that is the permanent cache hit.
    const fresh = query.totalComments <= was * (1 + GROWTH_TOLERANCE)
    if (!fresh) continue

    // And it read at least as much of the thread as we would now. Without
    // this, a summary generated from a deliberately tiny slice would be
    // served to a request asking for the whole thread — measured, and it is
    // exactly what happened the first time this tolerance was written.
    //
    // `query.comments` is only known once a render has already happened. The
    // cheap pre-render check has no render to compare, so it asks a
    // different question that needs none: would *this* request select the
    // same slice as the one that produced the candidate? Same strategy and
    // same budget on a thread that has not grown past tolerance renders
    // comparable coverage, without either side rendering.
    const deep =
      query.comments !== undefined
        ? candidate.input.comments >= query.comments * (1 - GROWTH_TOLERANCE)
        : candidate.input.strategy === query.strategy &&
          candidate.input.budgetChars === query.budgetChars

    if (deep) return candidate
  }
  return null
}

let cached: EnrichStore | undefined

export function getStore(): EnrichStore {
  cached ??= env.store === 'memory' ? createMemoryStore() : createDynamoStore()
  return cached
}

function createDynamoStore(): EnrichStore {
  // Constructed with the store itself, so importing this module in a
  // `memory` process neither reads credentials nor opens a socket.
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }))
  const TableName = env.enrichTableName

  return {
    async read(query) {
      const result = await doc.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
          ExpressionAttributeValues: {
            ':pk': pk(query.itemId),
            ':prefix': skPrefix(query.kind),
          },
          ScanIndexForward: false,
          Limit: READ_LIMIT,
        }),
      )

      // Parsed rather than cast, and a bad row is skipped rather than thrown:
      // a row written by an older deploy is exactly what a schema change
      // breaks, and the miss path can simply regenerate.
      const candidates: ThreadSummary[] = []
      for (const item of result.Items ?? []) {
        const parsed = ThreadSummarySchema.safeParse(item.summary)
        if (parsed.success) candidates.push(parsed.data)
        else console.error('discarding unparseable stored summary', item.pk, item.sk)
      }

      return usable(candidates, query)
    },

    async put(itemId, kind, summary) {
      await doc.send(
        new PutCommand({
          TableName,
          Item: {
            pk: pk(itemId),
            sk: sk(kind, summary),
            summary,
            expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
          },
        }),
      )
    },
  }
}

/**
 * Per-process and unbounded, which is right for what it is for: one `pnpm dev`
 * session or one Playwright run. Never the Lambda path — `STORE` defaults to
 * `dynamo` and only `applyLocalDefaults()` changes that.
 */
function createMemoryStore(): EnrichStore {
  const rows = new Map<string, ThreadSummary>()

  return {
    read: (query) => {
      const prefix = `${pk(query.itemId)}|${skPrefix(query.kind)}`
      const candidates = [...rows.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([, value]) => value)
      return Promise.resolve(usable(candidates, query))
    },
    put: (itemId, kind, summary) => {
      rows.set(`${pk(itemId)}|${sk(kind, summary)}`, summary)
      return Promise.resolve()
    },
  }
}
