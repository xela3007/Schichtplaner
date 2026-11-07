import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = new URL("../../../deploy/nginx/40-config-js.sh", import.meta.url)
  .pathname;

function run(env: Record<string, string>) {
  const target = join(mkdtempSync(join(tmpdir(), "cfg-")), "config.js");
  execFileSync("sh", [script], {
    env: { PATH: process.env.PATH ?? "", CONFIG_JS_PATH: target, ...env },
  });
  return readFileSync(target, "utf8");
}

describe("40-config-js.sh", () => {
  it("writes only API_BASE_URL — never other env vars", () => {
    const out = run({
      API_BASE_URL: "https://api.example.org",
      JWT_SECRET: "super-secret",
    });
    expect(out).toBe(
      'window.__APP_CONFIG__ = { "API_BASE_URL": "https://api.example.org" };\n',
    );
    expect(out).not.toContain("super-secret");
  });

  it("defaults to same origin and escapes quotes, backslashes and newlines", () => {
    expect(run({})).toContain('"API_BASE_URL": ""');
    const out = run({ API_BASE_URL: 'a"b\\c\nd' });
    expect(out).toContain('"API_BASE_URL": "a\\"b\\\\cd"');
  });
});
