import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@tylerschloesser/cdk-core/auth/browser'
import type { ThreadSummary as ThreadSummaryData } from '@yahn/schema'
import {
  ENRICH_EVENT,
  EnrichCompleteSchema,
  EnrichDeltaSchema,
  EnrichErrorSchema,
  EnrichMetaSchema,
} from '@yahn/schema'
import { readSSE } from '../../lib/sse.ts'
import styles from './ThreadSummary.module.css'

/**
 * The client state machine for one summary request. `cached` lives on the
 * `streaming` branch too because `meta` — which carries it — always arrives
 * before any `delta`, so it is known well before `complete` is.
 */
type State =
  | { status: 'idle' }
  | { status: 'streaming'; text: string; cached: boolean | null }
  | { status: 'complete'; summary: ThreadSummaryData; cached: boolean }
  | { status: 'error'; message: string }

type ThreadSummaryProps = {
  itemId: number
}

/**
 * Streams `GET /events/v1/enrich/thread/:id` and renders the markdown summary as
 * it is written.
 *
 * Deliberately **not** a TanStack Query. `.claude/rules/web-ui.md` makes
 * Query own caching for the read endpoints, but this is a one-shot,
 * user-triggered stream with no cache key of its own to hold — there is
 * nothing here for Query's stale-time/refetch model to do except get in the
 * way. Plain `useState` plus a manual `fetch` is the whole solution.
 */
export function ThreadSummary({ itemId }: ThreadSummaryProps) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  // Navigating away mid-stream must not leave a request running or set state
  // on an unmounted component.
  useEffect(() => () => abortRef.current?.abort(), [])

  async function start() {
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'streaming', text: '', cached: null })

    try {
      const response = await apiFetch(`/events/v1/enrich/thread/${String(itemId)}`, {
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`the request failed (${String(response.status)})`)
      }

      // Whether a terminal event actually arrived — a stream that just ends
      // is a failure, not a short summary, because a stream that already
      // sent a 200 cannot change its status code to report one.
      let terminal = false

      for await (const { event, data } of readSSE(response.body)) {
        if (event === ENRICH_EVENT.meta) {
          const meta = EnrichMetaSchema.parse(JSON.parse(data))
          setState((prev) => (prev.status === 'streaming' ? { ...prev, cached: meta.cached } : prev))
        } else if (event === ENRICH_EVENT.delta) {
          const delta = EnrichDeltaSchema.parse(JSON.parse(data))
          setState((prev) =>
            prev.status === 'streaming' ? { ...prev, text: prev.text + delta.text } : prev,
          )
        } else if (event === ENRICH_EVENT.complete) {
          const complete = EnrichCompleteSchema.parse(JSON.parse(data))
          const threadSummary = complete.enrichments.threadSummary
          if (!threadSummary) throw new Error('complete event carried no thread summary')
          terminal = true
          setState((prev) => ({
            status: 'complete',
            summary: threadSummary,
            cached: prev.status === 'streaming' && prev.cached === true,
          }))
        } else if (event === ENRICH_EVENT.error) {
          const err = EnrichErrorSchema.parse(JSON.parse(data))
          terminal = true
          setState({ status: 'error', message: err.error })
        }
      }

      if (!terminal) {
        setState({ status: 'error', message: 'The summary stream ended unexpectedly.' })
      }
    } catch (error) {
      // Aborting (unmount, or a second click) is not a failure to report.
      if (controller.signal.aborted) return
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to generate the summary.',
      })
    }
  }

  return (
    <section
      className={styles.root}
      data-testid="thread-summary"
      data-state={state.status}
      aria-live="polite"
      aria-busy={state.status === 'streaming'}
    >
      {(state.status === 'idle' || state.status === 'error') && (
        <button
          type="button"
          className={styles.button}
          data-testid="thread-summary-request"
          onClick={() => void start()}
        >
          {state.status === 'error' ? 'Try again' : 'Summarize thread'}
        </button>
      )}

      {/*
       * The summary is markdown (see `SUMMARY_SYSTEM` in
       * `apps/api/src/enrich/prompt.ts`) but this renders it as plain,
       * pre-wrapped text via `styles.text` (`white-space: pre-wrap`) rather
       * than transforming it into JSX. Two reasons: the text arrives one
       * delta at a time, and a heading or bullet marker can be split across
       * deltas, so a transform would flicker between "raw" and "parsed" as
       * each one completes; and React already escapes plain text, so there
       * is no need to reach for `dangerouslySetInnerHTML` — which must never
       * touch model output anyway.
       */}
      {state.status === 'streaming' && (
        <div className={styles.text} data-testid="thread-summary-text">
          {state.text || <span className={styles.placeholder}>Generating summary…</span>}
        </div>
      )}

      {state.status === 'complete' && (
        <>
          <div className={styles.text} data-testid="thread-summary-text">
            {state.summary.text}
          </div>
          <p className={styles.meta} data-testid="thread-summary-meta">
            {state.cached ? 'Cached' : 'Generated'} · {state.summary.model}
          </p>
        </>
      )}

      {state.status === 'error' && (
        <p className={styles.error} role="alert" data-testid="thread-summary-error">
          {state.message}
        </p>
      )}
    </section>
  )
}
