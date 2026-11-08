import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * ADR-007: a URL like /auth/verify-email is both an API route and a page.
 * Browser navigations (Accept: text/html) get the SPA, fetch calls go to the API.
 */
const api: ProxyOptions = {
  target: "http://localhost:3000",
  bypass: (req) =>
    req.headers.accept?.includes("text/html") ? "/index.html" : undefined,
};

export default defineConfig({
  root: r("./src/web"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "#shared": r("./src/shared"),
      "@": r("./src/web"),
    },
  },
  build: {
    outDir: r("./dist/web"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Exact API endpoints only: a bare "/auth" prefix would also capture the
    // frontend's own source modules under src/web/auth/ and send them to the API.
    proxy: {
      "^/(health|me|reference)(\\?.*)?$": api,
      "^/auth/(signup|verify-email|login|refresh|logout)(\\?.*)?$": api,
      // Pages live under /standorte, the API under /locations — no collision.
      "^/locations(/.*)?(\\?.*)?$": api,
      // Pages live under /mitarbeiter; employee API + Auswahllisten in English.
      "^/(employees|contract-types|qualifications|system-accesses)(/.*)?(\\?.*)?$":
        api,
    },
  },
});
