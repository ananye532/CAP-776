import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@domain': path.resolve(__dirname, '../server/src/domain') },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', sourcemap: false },
});
