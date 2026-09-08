import { useQuery, useQueryClient } from '@tanstack/react-query'
import { login, logout } from '@tylerschloesser/cdk-core/auth/browser'
import type { FormEvent } from 'react'
import { configQueryOptions, meQueryOptions } from '../../queries.ts'
import styles from './AuthMenu.module.css'

/**
 * Plain `useQuery`, not `useSuspenseQuery` — see `.claude/rules/web-ui.md`.
 * "Who is signed in" must never hold up the shell, so while either query is
 * pending this renders the signed-out state (or nothing) rather than a
 * spinner that would shift the header.
 */
export function AuthMenu() {
  const queryClient = useQueryClient()
  const configQuery = useQuery(configQueryOptions())
  const meQuery = useQuery(meQueryOptions())

  const config = configQuery.data
  const me = meQuery.data

  function invalidateMe() {
    void queryClient.invalidateQueries({ queryKey: ['me'] })
  }

  async function handleSignIn() {
    await login()
    invalidateMe()
  }

  function handleSignOut() {
    logout()
    invalidateMe()
  }

  async function handleDevSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) return
    await login(name)
    invalidateMe()
  }

  if (me) {
    return (
      <div className={styles.menu}>
        <span data-testid="auth-user" className={styles.user}>
          {me.email}
        </span>
        <button type="button" data-testid="auth-signout" className={styles.button} onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    )
  }

  if (config?.auth) {
    return (
      <div className={styles.menu}>
        <button
          type="button"
          data-testid="auth-signin"
          className={styles.button}
          onClick={() => void handleSignIn()}
        >
          Sign in with Google
        </button>
      </div>
    )
  }

  if (config?.mode === 'local') {
    return (
      <form className={styles.menu} onSubmit={(event) => void handleDevSubmit(event)}>
        <label htmlFor="auth-dev-name-input" className={styles.visuallyHidden}>
          Dev login name
        </label>
        <input
          id="auth-dev-name-input"
          name="name"
          type="text"
          placeholder="dev name"
          data-testid="auth-dev-name"
          className={styles.input}
        />
        <button type="submit" data-testid="auth-dev-login" className={styles.button}>
          Sign in
        </button>
      </form>
    )
  }

  return null
}
