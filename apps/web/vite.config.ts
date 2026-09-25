import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.PAGES_BASE_PATH || '/',
  envDir: '../..',
  build: { target: 'es2022' },
});
