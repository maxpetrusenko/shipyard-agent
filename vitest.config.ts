import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    maxWorkers: 2,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    teardownTimeout: 20_000,
  },
});
