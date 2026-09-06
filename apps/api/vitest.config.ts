import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Explicit imports from 'vitest' rather than globals, so the test files
    // typecheck under the same program as the source they exercise.
    include: ['src/**/*.test.ts'],
  },
})
