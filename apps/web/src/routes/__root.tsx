import { Link, Outlet, createRootRouteWithContext, useNavigate } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
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
  const [query, setQuery] = useState('')

  // A real <form> so Enter submits for free and the control is announced as
  // search — not a keydown listener on the input. Navigating with only `q`
  // (no `sort`/`p`) is what keeps the URL clean for a fresh search.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
            <input
              id="header-search-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search HN…"
              data-testid="search-input"
              className={styles.searchInput}
            />
          </form>
        </search>
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
