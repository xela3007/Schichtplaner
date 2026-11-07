import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Resolve #shared/* to the TS sources (package.json#imports "development").
    conditions: ["development"],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
