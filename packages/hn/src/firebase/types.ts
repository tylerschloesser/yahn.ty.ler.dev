import { z } from 'zod'

export const FirebaseItemTypeSchema = z.enum(['job', 'story', 'comment', 'poll', 'pollopt'])

/**
 * Raw Firebase item shape, matching `docs/hn-api.md`'s field table exactly.
 * Only `id` is required — the README omits every absent field entirely
 * rather than sending `null` for it, so everything else is `.optional()`.
 * `deleted` and `dead` are only ever observed as `true`, never `false`.
 *
 * `z.looseObject`: the README's versioning contract says clients must
 * tolerate fields it hasn't documented yet.
 */
export const FirebaseItemSchema = z.looseObject({
  id: z.number().int(),
  deleted: z.boolean().optional(),
  type: FirebaseItemTypeSchema.optional(),
  by: z.string().optional(),
  time: z.number().int().optional(),
  text: z.string().optional(),
  dead: z.boolean().optional(),
  parent: z.number().int().optional(),
  poll: z.number().int().optional(),
  kids: z.array(z.number().int()).optional(),
  url: z.string().optional(),
  score: z.number().int().optional(),
  title: z.string().optional(),
  parts: z.array(z.number().int()).optional(),
  descendants: z.number().int().optional(),
})

export type FirebaseItem = z.output<typeof FirebaseItemSchema>

/** Raw Firebase user shape. `id`, `created` and `karma` are required. */
export const FirebaseUserSchema = z.looseObject({
  id: z.string(),
  created: z.number().int(),
  karma: z.number().int(),
  about: z.string().optional(),
  submitted: z.array(z.number().int()).optional(),
})

export type FirebaseUser = z.output<typeof FirebaseUserSchema>
