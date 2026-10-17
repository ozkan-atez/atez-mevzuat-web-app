import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API (apps/api, :3100) /api altında; geliştirmede proxy ile aynı köken.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:3100' } },
})
