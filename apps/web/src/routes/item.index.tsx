import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * HN's own item URL is `/item?id=N`, not this app's `/item/$id` — this route
 * exists only so a link copied from HN, or a bookmark from before this app's
 * URL shape existed, still lands somewhere. It never renders: `beforeLoad`
 * either redirects or throws before a component would ever be needed.
 *
 * `id` is `coerce`d rather than parsed by hand because search values arrive
 * as strings off the URL; anything that doesn't coerce to an integer (missing,
 * non-numeric, `NaN`, zero, negative) is `undefined` here and turns into `notFound()` below
 * rather than a redirect to a broken `/item/undefined`.
 */
const itemSearchSchema = z.object({
  id: z.coerce.number().int().positive().optional().catch(undefined),
})

export const Route = createFileRoute('/item/')({
  validateSearch: itemSearchSchema,
  beforeLoad: ({ search }) => {
    if (search.id === undefined) throw notFound()
    // `item.$id.tsx`'s params are typed as `{ id: number }` — its own
    // `parse`/`stringify` pair is what turns that into the `/item/123` URL,
    // so this passes the number straight through rather than stringifying it
    // itself.
    throw redirect({ to: '/item/$id', params: { id: search.id }, replace: true })
  },
})
