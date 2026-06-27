import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';

// The dev server proxies API + WebSocket calls to the backend so the frontend
// can use same-origin relative URLs (no CORS, no hard-coded host).
export default defineConfig({
  plugins: [
    react(),
    // Tree-shaken SVG file-type icons (only the ones we import are bundled).
    Icons({ compiler: 'jsx', jsx: 'react' }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
