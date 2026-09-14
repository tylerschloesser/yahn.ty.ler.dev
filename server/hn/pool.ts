/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * returning results in input order regardless of completion order. Small and
 * dependency-free on purpose — this is the one concurrency primitive every
 * N+1 walk in this package (the comment tree, a feed page) goes through.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index] as T)
    }
  }

  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}
