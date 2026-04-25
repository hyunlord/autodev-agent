import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // SQLite DB is shared file → run test files sequentially to avoid
    // worker-level races (Stage 7 G1 added queries that mutate pipeline_run_state
    // and pipeline_events alongside store-persist tests).
    fileParallelism: false,
  },
});
