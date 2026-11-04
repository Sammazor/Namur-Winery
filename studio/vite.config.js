import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  server: { fs: { allow: ['..'] } },
});
