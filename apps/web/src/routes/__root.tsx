import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import styles from './__root.module.css'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
})

// Sections that exist on Hacker News but don't have a route yet — added in a
// later chunk. Rendered as inert spans rather than `Link`s: a `Link` to a
// route that doesn't exist yet is a type error, not just a dead link.
const upcomingSections = ['new', 'best', 'ask', 'show', 'jobs']

function RootLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          yahn
        </Link>
        <nav aria-label="Sections">
          <ul className={styles.nav}>
            {upcomingSections.map((section) => (
              <li key={section}>
                <span data-disabled className={styles.navItem} title="Coming soon">
                  {section}
                </span>
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
