import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Run as `vite web` / `vite build web`, so the root is this folder and the
// build lands in web/dist, which the hub server serves.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: {
    port: 5173,
    // The object form keeps changeOrigin false (the string shorthand turns it
    // on). The hub trusts loopback only when Host is localhost, and refuses
    // writes whose Origin differs from Host, so Host must pass through as-is.
    proxy: { '/api': { target: 'http://localhost:4747' } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
