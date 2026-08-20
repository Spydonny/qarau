import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.API_PORT ?? '8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The research API is same-origin in production. Proxying it in dev keeps
    // the session cookie first-party there too, so sameSite=strict behaves
    // identically in both environments.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
})
