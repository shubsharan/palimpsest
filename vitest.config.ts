import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    globalSetup: ["tests/support/vitest-global-setup.ts"],
    pool: "forks",
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: [
            "src/evaluation/evaluator.test.ts",
            "src/evaluation/overlap.test.ts",
            "src/evaluation/published-solver.test.ts",
            "src/experiment/execution.test.ts",
            "src/experiment/manifest.test.ts",
            "src/fixture/package.test.ts",
            "src/git.test.ts",
            "src/process.test.ts",
            "src/run/execution.test.ts",
            "src/run/record.test.ts",
            "src/sandbox/container.test.ts",
            "src/sandbox/workspace.test.ts",
            "src/seal.test.ts",
            "src/trace.test.ts",
          ],
          maxWorkers: 4,
        },
      },
      {
        test: {
          name: "contract",
          include: [
            "src/evaluation/overlap.test.ts",
            "src/evaluation/published-solver.test.ts",
            "src/experiment/manifest.test.ts",
            "src/fixture/package.test.ts",
            "src/process.test.ts",
            "src/run/record.test.ts",
            "src/sandbox/container.test.ts",
            "src/sandbox/workspace.test.ts",
            "src/seal.test.ts",
            "src/trace.test.ts",
            "tests/integration/**/*.test.ts",
            "tests/puzzle/cli.test.ts",
          ],
          maxWorkers: 4,
        },
      },
      {
        test: {
          name: "acceptance",
          include: [
            "src/evaluation/evaluator.test.ts",
            "src/experiment/execution.test.ts",
            "src/git.test.ts",
            "src/run/execution.test.ts",
            "tests/acceptance/**/*.test.ts",
          ],
          maxWorkers: 4,
        },
      },
      {
        test: {
          name: "docker",
          include: ["tests/puzzle/sandbox.integration.test.ts"],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
    testTimeout: 15_000,
  },
});
