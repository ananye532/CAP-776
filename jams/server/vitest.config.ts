import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://jams:jams@localhost:5432/jams_test',
      STORAGE_DIR: './.test-storage',
      ANTHROPIC_API_KEY: '',
    },
  },
});
