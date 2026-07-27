import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@palimpsest/contracts": `${root}packages/contracts/src/index.ts`,
      "@palimpsest/git-accounting": `${root}packages/git-accounting/src/index.ts`,
      "@palimpsest/git-gateway": `${root}packages/git-gateway/src/index.ts`,
      "@palimpsest/puzzle-runner": `${root}packages/puzzle-runner/src/index.ts`,
      "@palimpsest/run-control": `${root}packages/run-control/src/index.ts`,
    },
  },
  test: {
    coverage: {
      enabled: false,
    },
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 15_000,
  },
});
