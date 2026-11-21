import { defineConfig } from 'vite';

// Relative base so the build works from any path, including GitHub Pages.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
