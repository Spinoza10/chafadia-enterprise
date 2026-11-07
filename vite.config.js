import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// In development the API runs on 127.0.0.1:4000 (not reachable from the network); proxying keeps
// the app and API on one origin, so the refresh-token cookie stays SameSite=Strict and no CORS is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4000',
      '/uploads': 'http://127.0.0.1:4000',
    },
  },
  build: {
    // never publish source maps: they would expose the original source code
    sourcemap: false,
  },
})
