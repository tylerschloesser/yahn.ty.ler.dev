import { env } from './env.ts'
import { UpstreamError } from './errors.ts'

export type JsonResult<T> = { status: number; body: T | null; etag: string | null }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 100ms * 2 ** attempt, plus up to 50ms of jitter so retries from concurrent
// callers don't all land on the upstream at once.
function backoffMs(attempt: number): number {
  return 100 * 2 ** attempt + Math.random() * 50
}

/**
 * The one HTTP entrypoint every client in this package goes through. Uses the
 * global `fetch` on purpose: no custom agent, no `undici` dependency. Node's
 * built-in fetch already pools connections and keeps them alive, and
 * `docs/hn-api.md` records that the Firebase endpoint negotiates HTTP/1.1
 * only — there is no h2 multiplexing to lean on, so connection reuse is the
 * only transport-level mitigation available for the N+1 problem.
 */
export async function fetchJson<T>(
  url: string,
  options?: { headers?: Record<string, string>; timeoutMs?: number; retries?: number },
): Promise<JsonResult<T>> {
  const timeoutMs = options?.timeoutMs ?? env.httpTimeoutMs
  const retries = options?.retries ?? 2

  let attempt = 0
  for (;;) {
    try {
      const response = await fetch(url, {
        headers: options?.headers,
        signal: AbortSignal.timeout(timeoutMs),
      })

      // 304 carries Content-Length: 0 — do not attempt to parse a body.
      if (response.status === 304) {
        return { status: 304, body: null, etag: response.headers.get('etag') }
      }

      const retryableStatus = response.status === 429 || response.status >= 500
      if (!response.ok) {
        if (retryableStatus && attempt < retries) {
          await sleep(backoffMs(attempt))
          attempt += 1
          continue
        }
        throw new UpstreamError(`upstream ${response.status} for ${url}`, {
          status: response.status,
        })
      }

      const body = (await response.json()) as T
      return { status: response.status, body, etag: response.headers.get('etag') }
    } catch (error) {
      // A non-retryable failure (a 4xx other than 429, or retries exhausted)
      // surfaces as an UpstreamError thrown above — pass it straight through.
      if (error instanceof UpstreamError) throw error

      // Anything else here is a thrown network/abort error.
      if (attempt < retries) {
        await sleep(backoffMs(attempt))
        attempt += 1
        continue
      }
      throw new UpstreamError(`request failed for ${url}`, { cause: error })
    }
  }
}
