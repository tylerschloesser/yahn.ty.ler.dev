import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
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
      </header>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
