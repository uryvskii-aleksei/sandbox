import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/memo/',
  server: {
    port: 5173,
    strictPort: true,
    watch: { usePolling: true, interval: 200 },
    proxy: {
      '/memo/api': {
        target: `http://127.0.0.1:${process.env.API_PORT ?? 8081}`,
        rewrite: (url) => url.replace(/^\/memo/, ''),
      },
    },
  },
});
