import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { __SAKUYA_EDITION__: JSON.stringify(process.env.SAKUYA_EDITION === 'client' ? 'client' : 'dev') },
  build: { outDir: process.env.SAKUYA_EDITION === 'client' ? 'dist-client' : 'dist' },
  base: './',
  server: { port: Number(process.env.VITE_PORT || 5173), strictPort: true, watch: { ignored: ['**/.data/**', '**/.build/**', '**/.venv/**', '**/.tools/**', '**/release/**', '**/release-*/**'] }, proxy: { '/api': `http://127.0.0.1:${process.env.SAKUYA_PORT || 8120}`, '/_AMapService': `http://127.0.0.1:${process.env.SAKUYA_PORT || 8120}` } },
  preview: { port: 4173, proxy: { '/api': 'http://127.0.0.1:8120', '/_AMapService': 'http://127.0.0.1:8120' } },
});
