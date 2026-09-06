import Anthropic from '@anthropic-ai/sdk'
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { AWS_REGION, env } from '../../env.ts'
import { SUMMARY_SYSTEM, summaryPrompt } from '../prompt.ts'
import type { Model, SummaryResult } from './index.ts'

/**
 * The real provider. Copied from thai.ler.dev's `apps/api/src/model/anthropic.ts`,
 * which is where the secret handling and client construction were proven, and
 * changed in one way: this one **streams**.
 */

const MODEL = 'claude-opus-5'

/**
 * Generous, because the ceiling costs nothing unless it is used — only
 * generated tokens are billed. It has to cover adaptive thinking as well as
 * the summary itself, and a summary that hits the cap is truncated mid-sentence.
 */
const MAX_TOKENS = 16000

/** Leaves room inside the function's 5 minute timeout to record a failure. */
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000

let cached: Promise<Anthropic> | undefined

/**
 * The key lives in Secrets Manager and is fetched once per cold start — never
 * a plaintext env var, which would put it in the CloudFormation template where
 * anyone who can describe the stack can read it.
 */
function anthropic(): Promise<Anthropic> {
  cached ??= create()
  return cached
}

async function create(): Promise<Anthropic> {
  const secrets = new SecretsManagerClient({ region: AWS_REGION })
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: env.anthropicSecretId }))
  const raw = result.SecretString
  if (!raw) throw new Error('anthropic secret has no string value')

  return new Anthropic({ apiKey: extractApiKey(raw), timeout: REQUEST_TIMEOUT_MS })
}

/** Accepts either a bare key or the `{"apiKey": "..."}` shape the console produces. */
function extractApiKey(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return trimmed

  const parsed: unknown = JSON.parse(trimmed)
  if (parsed && typeof parsed === 'object') {
    const value = (parsed as Record<string, unknown>).apiKey
    if (typeof value === 'string' && value) return value
  }
  throw new Error('anthropic secret JSON has no apiKey field')
}

export function createAnthropicModel(): Model {
  return { summarize }
}

async function summarize(
  input: string,
  onDelta: (text: string) => Promise<void>,
): Promise<SummaryResult> {
  const client = await anthropic()

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // Adaptive is the only on-mode on this model, and `budget_tokens` is a 400
    // — do not reintroduce it from an older example.
    //
    // `effort: 'low'` is a deliberate choice for *this* workload rather than a
    // cost reflex. Summarizing a thread that is already in hand is not
    // intelligence-sensitive, and thinking tokens are generated **before** the
    // first visible token — so higher effort spends its cost squarely on
    // time-to-first-token, which is the number this whole streaming epoch
    // exists to make small.
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system: SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: summaryPrompt(input) }],
  })

  let text = ''
  for await (const event of stream) {
    if (event.type !== 'content_block_delta') continue
    if (event.delta.type !== 'text_delta') continue
    text += event.delta.text
    await onDelta(event.delta.text)
  }

  // Not a second request: the SDK assembles this from the events already
  // consumed above, which is where the billed token counts arrive.
  const final = await stream.finalMessage()

  if (!text) throw new Error('model returned no text')

  return {
    text,
    model: final.model,
    inputTokens: final.usage.input_tokens,
    outputTokens: final.usage.output_tokens,
  }
}
