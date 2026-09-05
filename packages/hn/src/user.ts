import type { User } from '@yahn/schema'
import * as firebase from './firebase/client.ts'

/**
 * Firebase-only, deliberately: Algolia's `/users/:username` record carries no
 * `created` (docs/hn-api.md), so Firebase is the only source for account age.
 */
export async function getUser(id: string): Promise<User> {
  const user = await firebase.getUser(id)
  return {
    id: user.id,
    created: user.created,
    karma: user.karma,
    about: user.about ?? null,
  }
}
