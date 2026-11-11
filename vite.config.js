import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// app.py serves the API and, after `npm run build`, this app from dist/ on the same origin.
// During `npm run dev` the API calls are proxied to it (start it first with `python app.py`).
const API = process.env.LOTUS_API || 'http://127.0.0.1:5000'
const proxy = Object.fromEntries(
  ['/terms', '/query', '/studies', '/help', '/health'].map((path) => [path, API]),
)

export default defineConfig({
  base: './', // relative asset URLs, so the same build works at / and at /lotus-bf/
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 3000, proxy },
  preview: { port: 3000, proxy },
  build: { chunkSizeWarningLimit: 3500 },
})
