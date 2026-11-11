import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend React nằm trong web/, build ra dist/ để Fastify phục vụ.
// Dev: `npm run dev:web` (cổng 5173) proxy API + probe sang Fastify (mặc định cổng 3000).
const backend = process.env.SENTINEL_BACKEND ?? 'http://127.0.0.1:3000';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/probe.js': backend,
      '/pow.js': backend,
      '/gate': backend,
      '/protected': backend,
    },
  },
});
