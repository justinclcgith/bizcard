import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { root: '..', include: ['gas/tests/**/*.test.js', 'tools/eval/**/*.test.mjs'] }
});
