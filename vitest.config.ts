import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@palimpsest/puzzle-runner": `${root}packages/puzzle-runner/src/index.ts`,
    },
  },
  test: {
    coverage: {
      enabled: false,
    },
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 15_000,
  },
});
