import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Restrict dependency scan to the main app entry to avoid pulling in reference HTML files.
    entries: ['index.html'],
    include: ['react', 'react-dom']
  },
  resolve: {
    dedupe: ['react', 'react-dom']
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts']
  },
  assetsInclude: ['**/*.png'],
  // Build-only optimizations: keep app code unchanged, improve chunking.
  build: {
    rollupOptions: {
      output: {
        // Split heavy and common dependencies into dedicated chunks.
        // This reduces the size of app-specific chunks like the Engine split.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/three/examples/')) return 'three-examples'
            if (id.includes('/three/')) return 'three'
            if (id.includes('/react/')) return 'react'
            if (id.includes('/react-dom/')) return 'react'
            // Group any other third-party modules together.
            return 'vendor'
          }
        }
      }
    }
  }
})
