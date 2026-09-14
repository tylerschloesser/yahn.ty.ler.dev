import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The API sets `max-age=30` on feed responses — matching staleTime here
      // means TanStack Query never refetches data the HTTP cache would have
      // served stale anyway.
      staleTime: 30_000,
      retry: 1,
    },
  },
})
