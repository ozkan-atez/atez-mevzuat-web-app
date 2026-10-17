import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Inside the dev container (docker-compose.override.yml) the API is another
 * service rather than a port on this host, the server has to listen on every
 * interface to be reachable through the published port, and a bind-mounted
 * source tree delivers no filesystem events — so edits need polling to be seen.
 */
const inContainer = process.env.VITE_DEV_CONTAINER === 'true'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: inContainer ? 80 : Number(process.env.VITE_PORT ?? 5173),
    host: inContainer ? '0.0.0.0' : 'localhost',
    proxy: {
      // v2 API (şablon stüdyosu, bileşen havuzu): /api/v2/* → v2 apps/api /api/*.
      // Sıra önemli: daha özel önek, genel /api'den önce.
      '/api/v2': {
        target: process.env.VITE_V2_API_PROXY_TARGET ?? 'http://127.0.0.1:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/v2/, '/api'),
      },
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
      }
    },
    watch: inContainer ? { usePolling: true, interval: 300 } : undefined,
  }
})
