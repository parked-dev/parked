import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://127.0.0.1:4747'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    // Dev only: forward /api to `node web.js`. It checks Host and Origin, so present ourselves as the backend.
    proxy: { '/api': { target: backend, changeOrigin: true, headers: { origin: backend } } },
  },
})
