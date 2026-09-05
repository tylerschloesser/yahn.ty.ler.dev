import type { FeedName } from '@yahn/schema'
import { env } from '../env.ts'
import { NotFoundError, UpstreamError } from '../errors.ts'
import { fetchJson } from '../http.ts'
import {
  FirebaseItemSchema,
  FirebaseUserSchema,
  type FirebaseItem,
  type FirebaseUser,
} from './types.ts'

const FEED_ENDPOINTS: Record<FeedName, string> = {
  top: 'topstories',
  new: 'newstories',
  best: 'beststories',
  ask: 'askstories',
  show: 'showstories',
  job: 'jobstories',
}

export async function getItem(id: number): Promise<FirebaseItem> {
  const { body } = await fetchJson<unknown>(`${env.firebaseBaseUrl}/item/${id}.json`)
  // A 200 with a null body is Firebase's way of saying "missing".
  if (body === null) throw new NotFoundError(`item ${id} not found`)
  return FirebaseItemSchema.parse(body)
}

// The username is case-sensitive: 'pg' and 'PG' would be different users.
export async function getUser(id: string): Promise<FirebaseUser> {
  const { body } = await fetchJson<unknown>(`${env.firebaseBaseUrl}/user/${id}.json`)
  if (body === null) throw new NotFoundError(`user ${id} not found`)
  return FirebaseUserSchema.parse(body)
}

export async function getMaxItem(): Promise<number> {
  const { body } = await fetchJson<number>(`${env.firebaseBaseUrl}/maxitem.json`)
  if (body === null) throw new UpstreamError('maxitem.json returned null')
  return body
}

const storyIdCache = new Map<FeedName, { etag: string; ids: number[] }>()

/**
 * The one revalidation mechanism Firebase offers: send `X-Firebase-ETag:
 * true` to opt in to getting an `ETag` back, then send it as `If-None-Match`
 * on the next request to get a `304` instead of a full body. Every response
 * — 200 or 304 — still carries `Cache-Control: no-cache`, so this dance is
 * the only lever available, and it is exactly what makes a warm Lambda
 * cheap: this cache is per-process, and a 304 costs nothing to parse.
 */
export async function getStoryIds(feed: FeedName): Promise<number[]> {
  const endpoint = FEED_ENDPOINTS[feed]
  const cached = storyIdCache.get(feed)
  const headers: Record<string, string> = { 'X-Firebase-ETag': 'true' }
  if (cached) headers['If-None-Match'] = cached.etag

  const { status, body, etag } = await fetchJson<number[]>(
    `${env.firebaseBaseUrl}/${endpoint}.json`,
    { headers },
  )

  if (status === 304) {
    if (!cached) throw new UpstreamError(`304 for ${feed} with nothing cached`)
    return cached.ids
  }

  if (body === null) throw new UpstreamError(`${endpoint}.json returned null`)
  // No ETag means the next request cannot revalidate, so the old entry has to
  // go: keeping it would send a stale `If-None-Match` and, on a 304, serve ids
  // that are two generations old.
  if (etag) storyIdCache.set(feed, { etag, ids: body })
  else storyIdCache.delete(feed)
  return body
}
