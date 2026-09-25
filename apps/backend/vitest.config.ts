import { defineConfig } from 'vitest/config';

// Three tiers (plan "Tooling assumptions"): default (no secrets), @github, @llm.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'default', include: ['test/**/*.test.ts'], exclude: ['test/**/*.github.test.ts', 'test/**/*.llm.test.ts'], testTimeout: 30_000, hookTimeout: 60_000 } },
      { test: { name: 'github', include: ['test/**/*.github.test.ts'], testTimeout: 120_000 } },
      { test: { name: 'llm', include: ['test/**/*.llm.test.ts'], testTimeout: 240_000, hookTimeout: 120_000, fileParallelism: false } },
    ],
  },
});
