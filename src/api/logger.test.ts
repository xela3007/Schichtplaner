import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

describe("logger redaction", () => {
  it("redacts auth headers, cookies and secret fields", () => {
    const { lines, stream } = capture();
    const logger = createLogger(
      { NODE_ENV: "test", LOG_LEVEL: "info" },
      stream,
    );

    logger.info({
      req: { headers: { authorization: "Bearer s3cr3t", cookie: "rt=s3cr3t" } },
      user: { password: "s3cr3t" },
      token: "s3cr3t",
    });

    const out = lines.join("");
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("[Redacted]");
  });
});
