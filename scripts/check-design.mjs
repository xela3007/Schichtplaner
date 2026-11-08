// Verifies the Dinexis design (ADR-011):
//  1. every token in styles.css' verbatim :root block equals the design system's
//  2. every text/background pair the UI uses meets WCAG AA
// Usage: node scripts/check-design.mjs <path to design system colors_and_type.css>
import { readFileSync } from "node:fs";

const [dsPath] = process.argv.slice(2);
const parse = (css) => {
  const root = css.match(/:root\s*\{[\s\S]*?\n\}/)[0];
  const map = new Map();
  for (const m of root.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    map.set(m[1], m[2].trim());
  return map;
};
const ds = parse(readFileSync(dsPath, "utf8"));
const app = parse(
  readFileSync(
    new URL("../src/web/dinexis-tokens.css", import.meta.url),
    "utf8",
  ),
);

let diffs = 0;
for (const [name, value] of ds) {
  if (app.get(name) !== value) {
    diffs++;
    console.log(`  ✗ ${name}: design=${value} app=${app.get(name)}`);
  }
}
console.log(
  `Tokens: ${ds.size} im Designsystem, ${diffs} Abweichungen im verbatim-Block`,
);

const hex = (name) => ds.get(name);
const lum = (h) => {
  const c = h
    .replace("#", "")
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255);
  const [r, g, b] = c.map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// [label, foreground, background, minimum]
const pairs = [
  ["Text (ink) auf Weiß", "--ink", "--paper", 4.5],
  ["Nebentext (ink-2) auf Weiß", "--ink-2", "--paper", 4.5],
  ["Nebentext (ink-2) auf paper-2", "--ink-2", "--paper-2", 4.5],
  ["Pill-Text (ink-2) auf paper-2", "--ink-2", "--paper-2", 4.5],
  ["Link/Nav (brand-700) auf Weiß", "--brand-700", "--paper", 4.5],
  ["Brand-Pill (brand-700) auf brand-050", "--brand-700", "--brand-050", 4.5],
  ["Button-Text Weiß auf graphite-900", "--paper", "--graphite-900", 4.5],
  [
    "Button-Text Weiß auf graphite-800 (hover)",
    "--paper",
    "--graphite-800",
    4.5,
  ],
  ["Fehlertext (danger) auf Weiß", "--danger", "--paper", 4.5],
  ["Alert-Text (ink) auf danger-100", "--ink", "--danger-100", 4.5],
  ["Alert-Text (ink) auf success-100", "--ink", "--success-100", 4.5],
  ["Destructive-Button Weiß auf danger", "--paper", "--danger", 4.5],
  ["Placeholder (ink-3) auf Weiß — nur Platzhalter", "--ink-3", "--paper", 3],
  // WCAG 1.4.11: boundaries that identify an input need 3:1
  ["Eingaberahmen (ink-3) auf Weiß — WCAG 1.4.11", "--ink-3", "--paper", 3],
  ["Eingaberahmen im Fokus (brand-700) auf Weiß", "--brand-700", "--paper", 3],
  ["Statuspunkt success auf Weiß — Grafik", "--success", "--paper", 3],
  ["Statuspunkt warning auf Weiß — Grafik", "--warning", "--paper", 2.5],
  ["Überschrift (ink) auf Weiß", "--ink", "--paper", 3],
];
let fails = 0;
for (const [label, fg, bg, min] of pairs) {
  const r = ratio(hex(fg), hex(bg));
  const ok = r >= min;
  if (!ok) fails++;
  console.log(`  ${ok ? "✓" : "✗"} ${r.toFixed(2)}:1 (min ${min}) ${label}`);
}
// informational: tokens deliberately NOT used as text
for (const [label, fg] of [
  ["border-strong als Eingaberahmen", "--border-strong"],
  ["success als Text", "--success"],
  ["warning als Text", "--warning"],
  ["ink-3 als Text", "--ink-3"],
  ["brand (cyan) als Text", "--brand"],
]) {
  console.log(
    `  i ${ratio(hex(fg), hex("--paper")).toFixed(2)}:1 ${label} auf Weiß — deshalb nicht als Textfarbe verwendet`,
  );
}
process.exit(diffs || fails ? 1 : 0);
