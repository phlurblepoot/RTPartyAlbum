import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PROXY_TARGET = 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: PROXY_TARGET, changeOrigin: true },
      '/media': { target: PROXY_TARGET, changeOrigin: true },
      '/socket.io': { target: PROXY_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
