import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy API + socket.io to the backend on :3000. In production the
// client is served from the same origin, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
