import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom']
  },
  server: {
    port: 5173,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    proxy: { '/api': 'http://localhost:4001', '/uploads': 'http://localhost:4001' }
  },
  build: {
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('/zod/')) return 'vendor-forms';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          if (id.includes('axios')) return 'vendor-http';
          if (id.includes('bootstrap')) return 'vendor-bootstrap';
        }
      }
    }
  }
});
