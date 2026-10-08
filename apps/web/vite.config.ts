import { compileCatalog } from '@bettermyadmin/i18n/compile'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { type Plugin, defineConfig } from 'vite'

/** packages/i18n/po/<code>.po → one lazily loaded catalogue chunk per locale (docs/architecture/10). */
function poCatalogs(): Plugin {
  return {
    name: 'bma-po-catalogs',
    transform(code, id) {
      if (!id.endsWith('.po')) return null
      return { code: `export default ${JSON.stringify(compileCatalog(code))}`, map: null }
    },
  }
}

export default defineConfig({
  plugins: [
    poCatalogs(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.BMA_API ?? 'http://localhost:8080', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true },
})
