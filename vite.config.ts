import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the build works from any subpath (GitHub Pages, S3 folder, …)
  base: './',
  server: { port: 5173, open: false },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  test: {
    // Hidden directories hold tool state and spare working copies, not tests.
    exclude: [...configDefaults.exclude, '**/.*/**'],
  },
})
