import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The .NET WebAssembly runtime lives in public/_framework (produced by
// `npm run build:engine`) and is loaded at runtime by the engine worker, so
// Vite must never try to bundle it.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
  server: { port: 5173, strictPort: false },
  preview: { port: 4173, strictPort: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as never);
