import { describe, expect, it } from "vitest";

import tokens from "./dinexis-tokens.css?raw";
import css from "./styles.css?raw";

describe("styles.css (Dinexis, ADR-011)", () => {
  it("loads no fonts from Google (self-hosted, DSGVO)", () => {
    expect(css + tokens).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it("has no dark theme (light only until the design system defines one)", () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it("carries the Dinexis brand tokens", () => {
    expect(tokens).toContain("--brand:          #0CE8F6;");
    expect(tokens).toContain("--magenta:        #E03D80;");
    expect(tokens).toContain("--graphite-900:   #202124;");
  });

  it("never uses ink-3 for muted text (fails WCAG AA on white)", () => {
    expect(css).toMatch(/--muted-foreground:\s*var\(--ink-2\)/);
  });
});
