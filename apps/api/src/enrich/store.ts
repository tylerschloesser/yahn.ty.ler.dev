import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { ThreadSummarySchema, type EnrichmentKind, type ThreadSummary } from '@yahn/schema'
import { AWS_REGION, env } from '../env.ts'

/**
 * Where a generated enrichment lives so it is generated once.
 *
 * `pk=ITEM#<id>` / `sk=ENRICH#<kind>#<inputKey>`. The last segment hashes the
 * **model input**, not the story's `contentKey` — a story's `contentKey` is
 * `sha256(url ?? text)` and does not move when comments arrive, so keying a
 * thread summary on it would pin the first summary of an empty thread forever.
 * See `ThreadSummarySchema.inputKey` in `@yahn/schema`.
 *
 * `STORE=memory` is what lets `pnpm dev` and `pnpm e2e` run the whole
 * read-through path with no AWS account. `applyLocalDefaults()` sets it.
 */

export interface EnrichStore {
  get(itemId: number, kind: EnrichmentKind, inputKey: string): Promise<ThreadSummary | null>
  put(itemId: number, kind: EnrichmentKind, summary: ThreadSummary): Promise<void>
}

/** A summary of a thread nobody has opened in a month is not worth storing. */
const TTL_SECONDS = 30 * 24 * 60 * 60

function pk(itemId: number): string {
  return `ITEM#${itemId}`
}

function sk(kind: EnrichmentKind, inputKey: string): string {
  return `ENRICH#${kind}#${inputKey}`
}

let cached: EnrichStore | undefined

export function getStore(): EnrichStore {
  cached ??= env.store === 'memory' ? createMemoryStore() : createDynamoStore()
  return cached
}

function createDynamoStore(): EnrichStore {
  // Constructed lazily with the store itself, so importing this module in a
  // `fake`/`memory` process neither reads credentials nor opens a socket.
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }))
  const TableName = env.enrichTableName

  return {
    async get(itemId, kind, inputKey) {
      const result = await doc.send(
        new GetCommand({ TableName, Key: { pk: pk(itemId), sk: sk(kind, inputKey) } }),
      )
      if (!result.Item) return null

      // Parsed rather than cast. A row written by an older deploy is the exact
      // case a schema change breaks, and failing here — where the miss path
      // can simply regenerate — beats shipping a malformed summary to a client.
      const parsed = ThreadSummarySchema.safeParse(result.Item.summary)
      if (!parsed.success) {
        console.error('discarding unparseable stored summary', pk(itemId), sk(kind, inputKey))
        return null
      }
      return parsed.data
    },

    async put(itemId, kind, summary) {
      await doc.send(
        new PutCommand({
          TableName,
          Item: {
            pk: pk(itemId),
            sk: sk(kind, inputKey_(summary)),
            summary,
            expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
          },
        }),
      )
    },
  }
}

/**
 * Per-process and unbounded, which is fine for what it is for: one `pnpm dev`
 * session or one Playwright run. It is never the Lambda path — `STORE`
 * defaults to `dynamo` and only `applyLocalDefaults()` changes that.
 */
function createMemoryStore(): EnrichStore {
  const rows = new Map<string, ThreadSummary>()

  return {
    get: (itemId, kind, inputKey) =>
      Promise.resolve(rows.get(`${pk(itemId)}|${sk(kind, inputKey)}`) ?? null),
    put: (itemId, kind, summary) => {
      rows.set(`${pk(itemId)}|${sk(kind, inputKey_(summary))}`, summary)
      return Promise.resolve()
    },
  }
}

/** The summary carries the key it was generated under; `put` never invents one. */
function inputKey_(summary: ThreadSummary): string {
  return summary.inputKey
}
