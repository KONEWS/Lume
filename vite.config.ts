import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:46321', '/media': 'http://127.0.0.1:46321', '/artwork': 'http://127.0.0.1:46321', '/ws': { target: 'ws://127.0.0.1:46321', ws: true } }
  }
});
