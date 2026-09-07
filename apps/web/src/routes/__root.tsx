import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { AuthMenu } from '../components/AuthMenu/AuthMenu.tsx'
import { SECTIONS } from '../feeds.ts'
import styles from './__root.module.css'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

// Highlight the current section by pathname only. Including the search params
// would make paginating past page 1 read as "no section active".
const activeOptions = { exact: true, includeSearch: false }
const activeProps = { 'data-active': '' }

function RootLayout() {
  const navigate = useNavigate()
  // `strict: false` reads `q` from whichever matched route declares it (only
  // `/search`) and is `undefined` everywhere else — the root layout sits
  // above `/search` in the tree, so it cannot use that route's own
  // `useSearch()`.
  const activeQuery = useSearch({ strict: false, select: (search) => search.q ?? '' })

  // A real <form> so Enter submits for free and the control is announced as
  // search — not a keydown listener on the input. Navigating with only `q`
  // (no `sort`/`p`) is what keeps the URL clean for a fresh search.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = String(new FormData(event.currentTarget).get('q') ?? '')
    void navigate({ to: '/search', search: { q: query } })
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          yahn
        </Link>
        <nav aria-label="Sections">
          <ul className={styles.nav}>
            {SECTIONS.map((section) => (
              <li key={section.path}>
                <Link
                  to={section.path}
                  data-testid="nav-link"
                  className={styles.navItem}
                  activeOptions={activeOptions}
                  activeProps={activeProps}
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <search className={styles.search}>
          <form onSubmit={handleSubmit}>
            <label htmlFor="header-search-input" className={styles.searchLabel}>
              Search
            </label>
            {/* Uncontrolled and keyed on the URL's query: remounting on
                navigation (back/forward, a link to a different query) is what
                keeps the box in sync without fighting the user's own typing
                between submits. */}
            <input
              key={activeQuery}
              id="header-search-input"
              name="q"
              type="search"
              defaultValue={activeQuery}
              placeholder="Search HN…"
              data-testid="search-input"
              className={styles.searchInput}
            />
          </form>
        </search>
        <AuthMenu />
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
