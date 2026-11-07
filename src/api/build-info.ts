import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Env } from "./env.js";

export type BuildInfo = {
  version: string;
  commit: string | null;
  startedAt: Date;
};

const PackageJson = z.object({ version: z.string() });

// Resolves to the repo root from both src/api and dist/api.
const packageJsonUrl = new URL("../../package.json", import.meta.url);

export function getBuildInfo(env: Pick<Env, "GIT_COMMIT_SHA">): BuildInfo {
  const pkg = PackageJson.parse(
    JSON.parse(readFileSync(packageJsonUrl, "utf8")),
  );
  return {
    version: pkg.version,
    commit: env.GIT_COMMIT_SHA ?? null,
    startedAt: new Date(),
  };
}
