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
      // Mirrors CloudFront's two API behaviors, so the client uses one
      // same-origin path everywhere and needs no base URL. Both target a real
      // local backend rather than production, so local requests never touch
      // production data.
      //
      // Enrichment is listed first because Vite matches proxy keys by prefix in
      // insertion order, and `/api` would otherwise swallow it. It is a separate
      // server for the same reason it is a separate Lambda in production:
      // response streaming is fixed at function-URL creation, and these
      // responses must never be cached while reads are cached hard.
      '/api/v1/enrich': { target: 'http://localhost:3002', changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
