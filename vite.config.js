import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173 },
  // .glsl is imported with ?raw everywhere, so HMR fires on shader save.
  assetsInclude: ['**/*.glsl'],
});
