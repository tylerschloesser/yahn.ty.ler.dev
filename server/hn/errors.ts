/**
 * Thrown when Firebase or Algolia says an item/user does not exist.
 *
 * Firebase answers a missing item or user with HTTP 200 and a `null` body —
 * there is no 404 on that API. Mapping that `null` to `NotFoundError` is this
 * layer's job; `apps/api` is the one that turns a `NotFoundError` into an
 * actual 404 response. Algolia returns a real 404, which is mapped the same
 * way for a uniform contract across both clients.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** Anything else that goes wrong talking to Firebase or Algolia. */
export class UpstreamError extends Error {
  status: number | undefined

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause })
    this.name = 'UpstreamError'
    this.status = options?.status
  }
}
