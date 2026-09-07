import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { handleCallback } from '@tylerschloesser/cdk-core/auth/browser'
import { useEffect, useRef, useState } from 'react'

/**
 * The Cognito leg of a login: exchange the `?code=` for tokens, then put the
 * user back where they started with none of Cognito's query string left in the
 * URL. Served `index.html` by the SPA fallback CloudFront Function, which is on
 * the default behavior — this route needs no infrastructure of its own.
 */
export const Route = createFileRoute('/auth/callback')({
  component: AuthCallback,
})

function AuthCallback() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  // `handleCallback` is **one-shot**: it consumes the PKCE verifier out of
  // `sessionStorage`, so a second call fails with a bad-state error rather
  // than being a harmless retry. StrictMode mounts, unmounts and remounts
  // every effect in development, and `navigate`/`queryClient` are only
  // *usually* referentially stable — so the guard against running twice is a
  // ref, not the dependency array.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    // `cancelled` is the separate concern: it stops state being set after an
    // unmount mid-flight (oxlint's `react/set-state-in-effect` is on at
    // `correctness: error`).
    let cancelled = false

    handleCallback(window.location.search)
      .then((returnTo) => {
        if (cancelled) return
        void queryClient.invalidateQueries({ queryKey: ['me'] })
        // `returnTo` is a runtime string, not a statically known route, so
        // `href` (not `to`) is the form `NavigateOptions` accepts for it.
        void navigate({ href: returnTo, replace: true })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [navigate, queryClient])

  if (error) {
    return <p>Sign-in failed: {error}</p>
  }

  return <p>Signing you in…</p>
}
