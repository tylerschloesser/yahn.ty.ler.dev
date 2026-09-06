import { setTimeout } from 'node:timers/promises'
import { env } from '../../env.ts'
import type { Model, SummaryResult } from './index.ts'

/**
 * The `MODEL_PROVIDER=fake` implementation — no network, no secret, no cost.
 * It is what `pnpm dev`, `pnpm verify` and `pnpm e2e` run against, so it is
 * not a testing convenience but the thing that keeps those three
 * credential-free.
 *
 * It streams in several chunks with a delay between them rather than
 * returning all at once, because a Playwright spec asserting that a summary
 * *arrives incrementally* has to have something incremental to watch. The
 * delay is small so the suite stays fast, and `FAKE_MODEL_DELAY_MS` tunes it.
 */

const MODEL = 'fake'

export function createFakeModel(): Model {
  return { summarize }
}

async function summarize(
  input: string,
  onDelta: (text: string) => Promise<void>,
): Promise<SummaryResult> {
  const chunks = fakeSummary(input)

  for (const chunk of chunks) {
    await setTimeout(env.fakeModelDelayMs)
    await onDelta(chunk)
  }

  return {
    text: chunks.join(''),
    model: MODEL,
    // `fake` bills nothing, and reporting 0 would be a lie a cost measurement
    // could quietly average in. `null` means "not measured".
    inputTokens: null,
    outputTokens: null,
  }
}

/**
 * Deterministic given its input, so a test can assert on it and so two runs
 * over the same thread produce the same `inputKey` -> same stored row.
 */
function fakeSummary(input: string): string[] {
  const title = /^Story: (.*)$/m.exec(input)?.[1] ?? 'this thread'
  const commentLines = input.split('\n').filter((line) => /^\s*\[\d+]/.test(line)).length

  return [
    `## What the thread is about\n\n`,
    `A fake summary of **${title}**, generated without calling a model. `,
    `It read ${commentLines} comment(s) and ${input.length} characters of input.\n\n`,
    `## Main threads of discussion\n\n`,
    `- This is the \`fake\` model provider, so there is no real analysis here.\n`,
    `- It exists so that \`pnpm dev\`, \`pnpm verify\` and \`pnpm e2e\` need no API key.\n`,
    `- Set \`MODEL_PROVIDER=anthropic\` with a key in Secrets Manager for the real thing.\n`,
  ]
}
