import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.BMA_API ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true },
})
