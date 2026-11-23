import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/mind-assistant/',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/mind-assistant/api': {
        target: 'http://127.0.0.1:8081',
        rewrite: (url) => url.replace(/^\/mind-assistant/, ''),
      },
    },
  },
});
