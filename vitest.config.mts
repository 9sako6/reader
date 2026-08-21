import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: [
      "apps/*/tests/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
    ],
  },
});
