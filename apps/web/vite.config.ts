import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Serves the same `__config.json` a real deploy writes into the asset prefix:
// the bundle learns its environment at runtime, never at build time, so
// local dev has to hand it one too. Shared between `configureServer` (vite
// dev) and `configurePreviewServer` (vite preview) so both loops match a
// real deploy. `mode: 'local'` carries no `auth` key — there is no user pool
// locally.
function localConfigJson(): Plugin {
  const serve = (
    req: import('http').IncomingMessage,
    res: import('http').ServerResponse,
    next: () => void,
  ): void => {
    if (req.url !== '/__config.json') {
      next()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ site: 'localhost', mode: 'local' }))
  }

  return {
    name: 'local-config-json',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Must precede the React plugin so generated route modules are transformed.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    localConfigJson(),
  ],
  server: {
    proxy: {
      // Mirrors CloudFront's two API behaviors, so the client uses one
      // same-origin path everywhere and needs no base URL. Both target a real
      // local backend rather than production, so local requests never touch
      // production data.
      //
      // Enrichment is a separate server for the same reason it is a separate
      // Lambda in production: response streaming is fixed at function-URL
      // creation, and these responses must never be cached while reads are
      // cached hard.
      '/events': { target: 'http://localhost:3002', changeOrigin: true },
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
