import type { User } from '@yahn/schema'
import { sanitizeHnHtml } from '../../lib/html.ts'
import { timeAgo } from '../../lib/time.ts'
import styles from './UserProfile.module.css'

type UserProfileProps = {
  user: User
}

export function UserProfile({ user }: UserProfileProps) {
  const iso = new Date(user.created * 1000).toISOString()

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{user.id}</h1>
      <div className={styles.subtext}>
        <span data-testid="user-karma">{user.karma} karma</span>
        <time dateTime={iso} data-testid="user-created">
          joined {timeAgo(user.created)}
        </time>
      </div>
      {user.about && (
        // Third-party HTML from Hacker News. sanitizeHnHtml is what makes
        // this safe: it allowlists a small set of inline tags and only ever
        // keeps an http(s) href on <a>, forcing rel="nofollow noreferrer".
        <div className={styles.body} dangerouslySetInnerHTML={{ __html: sanitizeHnHtml(user.about) }} />
      )}
    </header>
  )
}
