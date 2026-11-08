import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          // Resolve #shared/* to the TS sources (package.json#imports "development").
          conditions: ["development"],
        },
        test: {
          name: "api",
          environment: "node",
          include: ["src/api/**/*.test.ts", "src/shared/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { "#shared": r("./src/shared"), "@": r("./src/web") },
        },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/web/**/*.test.{ts,tsx}"],
          // styles.test.ts reads the stylesheets via ?raw — by default Vitest
          // turns every CSS import into an empty module.
          css: { include: [/styles\.css|dinexis-tokens\.css/] },
        },
      },
    ],
  },
});
