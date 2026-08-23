import { defineConfig } from "vitest/config";

export default defineConfig({
  benchmark: {
    include: ["benchmark/**/*.bench.ts"],
    includeSamples: true,
  },
  test: {
    environment: "node",
    globals: true,
    include: [
      "apps/*/tests/**/*.test.ts",
      "packages/**/tests/**/*.test.ts",
      "benchmark/**/*.test.ts",
      "tests/ci/**/*.test.ts",
    ],
  },
});
