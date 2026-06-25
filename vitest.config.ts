import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/renderer/src/test/setup.ts'],
    css: true,
    globals: true,
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['src/main/**', 'src/preload/**', 'tests/**']
    }
  }
});
