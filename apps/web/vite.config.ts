import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must precede the React plugin so generated route modules are transformed.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
  ],
  server: {
    proxy: {
      // Mirrors the CloudFront `/api/*` behavior so the client uses one
      // same-origin path everywhere and needs no base URL. Unlike a
      // production-pointed proxy, this always targets a real local backend
      // (`apps/api`, added in a later chunk) — there is no production API to
      // point at yet, and local requests never touch production data.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
