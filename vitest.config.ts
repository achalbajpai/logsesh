import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/test/**",
        "packages/cli/src/index.ts",
        "packages/cli/src/util/shared-options.ts",
      ],
      thresholds: {
        "packages/core/src/**": {
          statements: 75,
          branches: 48,
          functions: 78,
          lines: 78,
        },
        "packages/cli/src/**": {
          statements: 70,
          branches: 45,
          functions: 65,
          lines: 70,
        },
      },
    },
  },
});
