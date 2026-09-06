/**
 * A minimal server-sent-events parser over a `fetch` response body.
 *
 * Not `EventSource`: it cannot be pointed at a `fetch` `Response` (it only
 * ever makes its own GET) and it has no way to plug in an `AbortController`,
 * both of which this needs — the stream must stop the moment a reader
 * navigates away. `fetch` + this generator gets both for free.
 */

export interface SSEEvent {
  event: string
  data: string
}

/**
 * Yields one `SSEEvent` per frame. Frames are separated by a blank line;
 * within a frame, `event:` names it and `data:` lines (there can be more
 * than one) are joined with `\n` for the payload. A line starting with `:`
 * is a keepalive comment and is skipped, per the contract in
 * `@yahn/schema`'s `enrich-stream.ts`.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const parsed = parseFrame(frame)
        if (parsed) yield parsed
      }
    }

    // The socket can close right after the final frame with no trailing
    // blank line — don't drop it.
    const last = parseFrame(buffer)
    if (last) yield last
  } finally {
    reader.releaseLock()
  }
}

function parseFrame(frame: string): SSEEvent | null {
  let event = 'message'
  const dataLines: string[] = []

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line === '' || line.startsWith(':')) continue
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
