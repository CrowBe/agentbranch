import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Design-system conformance (DESIGN.md §5.3) — deterministic drift guards
 * between the three places the visual system lives:
 *
 *   1. docs/DESIGN.md §4 (the palette contract)
 *   2. src/app/globals.css (the token layer)
 *   3. src/components + src/app TSX (the usage)
 *
 * Catches the silent failure mode where a component names a token that does
 * not exist — Tailwind generates nothing for an unknown class, so the bug
 * ships invisibly (a modal without its scrim, a label at body size).
 */

const ROOT = join(__dirname, "..", "..");
const CSS = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8");
const DESIGN = readFileSync(join(ROOT, "docs", "DESIGN.md"), "utf8");

// --- parse the token layer --------------------------------------------------

/** Custom properties of one top-level block, e.g. `:root { ... }`. */
function cssBlockTokens(selector: string): Map<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `globals.css must have a ${selector} block`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

/** The `.text-*` type-scale classes the token layer defines. */
function definedTypeClasses(): Set<string> {
  return new Set([...CSS.matchAll(/^\.text-([a-z-]+)\s*\{/gm)].map((m) => m[1]!));
}

// --- parse the palette contract in DESIGN.md ---------------------------------

/** Role → hex rows of one §4 theme table (rows like `| \`primary\` (cobalt) | \`#004ac6\` |`). */
function designPaletteTable(heading: string): Map<string, string> {
  const start = DESIGN.indexOf(heading);
  expect(start, `DESIGN.md must have the section "${heading}"`).toBeGreaterThanOrEqual(0);
  const end = DESIGN.indexOf("###", start + heading.length);
  const section = DESIGN.slice(start, end === -1 ? undefined : end);
  const roles = new Map<string, string>();
  for (const match of section.matchAll(/^\|\s*`([a-z-]+)`[^|]*\|\s*`(#[0-9a-fA-F]+)`\s*\|/gm)) {
    roles.set(match[1]!, match[2]!.toLowerCase());
  }
  return roles;
}

/** Type-scale token names from the DESIGN.md §3.2 table. */
function designTypeTokens(): string[] {
  const start = DESIGN.indexOf("### 3.2 Type scale");
  const end = DESIGN.indexOf("###", start + 1 + "### 3.2 Type scale".length);
  const section = DESIGN.slice(start, end);
  return [...section.matchAll(/^\|\s*`([a-z-]+)`\s*\|/gm)].map((m) => m[1]!);
}

// --- collect presentation sources --------------------------------------------

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxFilesUnder(path));
    else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(path);
  }
  return out;
}

const SOURCES = [
  ...tsxFilesUnder(join(ROOT, "src", "components")),
  ...tsxFilesUnder(join(ROOT, "src", "app")),
].map((path) => ({ path: path.slice(ROOT.length + 1), text: readFileSync(path, "utf8") }));

// --- the guards ---------------------------------------------------------------

describe("token layer ⇄ DESIGN.md", () => {
  const light = cssBlockTokens(":root");
  const dark = cssBlockTokens('[data-theme="dark"]');

  it("light and dark themes define the same semantic roles", () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it("globals.css hex values match the DESIGN.md §4 palette, both themes", () => {
    const cases: [string, Map<string, string>][] = [
      ["### 4.1 Light theme", light],
      ["### 4.2 Dark theme", dark],
    ];
    for (const [heading, theme] of cases) {
      const documented = designPaletteTable(heading);
      expect(documented.size, `${heading} table parsed`).toBeGreaterThan(0);
      for (const [role, hex] of documented) {
        expect(theme.get(role), `${heading}: --${role}`).toBe(hex);
      }
    }
  });

  it("every DESIGN.md §3.2 type token has a .text-* class in globals.css", () => {
    const classes = definedTypeClasses();
    const tokens = designTypeTokens();
    expect(tokens.length).toBeGreaterThan(0);
    const missing = tokens.filter((token) => !classes.has(token));
    expect(missing, "type tokens without a .text-* class").toEqual([]);
  });
});

describe("component usage ⇄ token layer", () => {
  const typeClasses = definedTypeClasses();
  const roles = new Set(cssBlockTokens(":root").keys());
  // Tailwind utilities that share a color-utility prefix but are not colors.
  const NON_COLOR = new Set(["left", "center", "right", "justify", "clip", "wrap", "nowrap", "balance", "pretty", "ellipsis"]);

  it("every text-* type class a component uses is defined", () => {
    for (const { path, text } of SOURCES) {
      const used = [...text.matchAll(/\btext-((?:display|headline|body|doc|label|title)[a-z-]*)\b/g)].map(
        (m) => m[1]!,
      );
      const unknown = used.filter((name) => !typeClasses.has(name));
      expect(unknown, `${path}: text-* classes with no definition in globals.css`).toEqual([]);
    }
  });

  it("every color utility a component uses names a real semantic role", () => {
    for (const { path, text } of SOURCES) {
      const unknown: string[] = [];
      for (const match of text.matchAll(/\b(bg|border|ring|accent|fill|stroke)-([a-z][a-z-]*[a-z])(?:\/\d+)?\b/g)) {
        const name = match[2]!;
        if (roles.has(name) || NON_COLOR.has(name)) continue;
        unknown.push(`${match[1]!}-${name}`);
      }
      expect(unknown, `${path}: color utilities that name no semantic role`).toEqual([]);
    }
  });

  it("text color utilities stay on the semantic roles too", () => {
    // text-<role> is the color side of the text- prefix; type classes are
    // checked above, structural utilities are excluded here.
    const STRUCTURAL = new Set([...NON_COLOR, "xs", "sm", "md", "lg", "xl"]);
    for (const { path, text } of SOURCES) {
      const unknown: string[] = [];
      for (const match of text.matchAll(/\btext-([a-z][a-z-]*[a-z])(?:\/\d+)?\b/g)) {
        const name = match[1]!;
        const isTypeToken = /^(display|headline|body|doc|label|title)/.test(name);
        if (isTypeToken || roles.has(name) || STRUCTURAL.has(name)) continue;
        unknown.push(`text-${name}`);
      }
      expect(unknown, `${path}: text-* utilities that are neither type tokens nor roles`).toEqual([]);
    }
  });

  it("shadows are overlay-only — no Tailwind shadow-* utilities", () => {
    for (const { path, text } of SOURCES) {
      const shadows = [...text.matchAll(/\bshadow-(?:2xs|xs|sm|md|lg|xl|2xl)\b/g)].map((m) => m[0]!);
      expect(shadows, `${path}: use .elevation-overlay (DESIGN §3.6), not shadow-*`).toEqual([]);
    }
  });

  it("no raw font sizes or hex colors in components", () => {
    for (const { path, text } of SOURCES) {
      const rawSizes = [...text.matchAll(/\btext-\[\d+(?:px|rem)\]/g)].map((m) => m[0]!);
      expect(rawSizes, `${path}: compose the §3.2 type scale, not arbitrary sizes`).toEqual([]);
      const rawHex = [...text.matchAll(/className="[^"]*#[0-9a-fA-F]{3,8}[^"]*"/g)].map((m) => m[0]!);
      expect(rawHex, `${path}: colors resolve from §4 roles, never inline hex`).toEqual([]);
    }
  });
});
