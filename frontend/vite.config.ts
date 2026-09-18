import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Target em 127.0.0.1, nunca `localhost`: a API faz bind explícito em
      // 127.0.0.1 (backend/src/http/server.ts) e no Windows `localhost`
      // resolve `::1` antes de `127.0.0.1`, o que derruba o proxy com
      // ECONNREFUSED ::1:3000.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
});
