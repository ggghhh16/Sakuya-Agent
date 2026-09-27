import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: Number(process.env.VITE_PORT || 5173), strictPort: true, watch: { ignored: ['**/.data/**', '**/.build/**', '**/.venv/**', '**/.tools/**', '**/release/**', '**/release-*/**'] }, proxy: { '/api': `http://127.0.0.1:${process.env.SAKUYA_PORT || 8120}` } },
  preview: { port: 4173, proxy: { '/api': 'http://127.0.0.1:8120' } },
});
