import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_SETS } from "@/app/themes/registry";

/**
 * Design-system conformance (DESIGN.md §5.3) — deterministic drift guards
 * between the four places the visual system lives:
 *
 *   1. docs/DESIGN.md §4 (the palette contract, one table per theme)
 *   2. src/app/themes/registry.ts (the theme-set registry)
 *   3. src/app/globals.css + src/app/themes/*.css (the token layer)
 *   4. src/components + src/app TSX (the usage)
 *
 * Catches the silent failure mode where a component names a token that does
 * not exist — Tailwind generates nothing for an unknown class, so the bug
 * ships invisibly (a modal without its scrim, a label at body size).
 */

const ROOT = join(__dirname, "..", "..");
const THEMES_DIR = join(ROOT, "src", "app", "themes");
const CSS = [
  readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8"),
  ...readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith(".css"))
    .map((name) => readFileSync(join(THEMES_DIR, name), "utf8")),
].join("\n");
const DESIGN = readFileSync(join(ROOT, "docs", "DESIGN.md"), "utf8");

/**
 * Look tokens (DESIGN §3): the full-look layer a *custom* theme set may
 * override. Everything else in a theme block must be a §4 semantic role.
 * The system pair may restyle only the overlay shadow.
 */
const LOOK_TOKENS = new Set([
  "type-display",
  "type-body",
  "type-mono",
  "shape-sm",
  "shape-md",
  "shape-lg",
  "shape-xl",
  "overlay-shadow",
]);

function themeSelector(id: string): string {
  return id === "light" ? ":root" : `[data-theme="${id}"]`;
}

/** The semantic color roles of a block — its tokens minus the look layer. */
function colorRoles(tokens: Map<string, string>): Map<string, string> {
  return new Map([...tokens].filter(([name]) => !LOOK_TOKENS.has(name)));
}

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
function designPaletteTable(themeLabel: string): Map<string, string> {
  // Each theme's palette lives under a `### … <Label> theme …` heading.
  const heading = new RegExp(`^### .*${themeLabel} theme.*$`, "m").exec(DESIGN);
  expect(heading, `DESIGN.md must have a §4 heading for the ${themeLabel} theme`).not.toBeNull();
  const start = heading!.index;
  const end = DESIGN.indexOf("###", start + heading![0].length);
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

describe("token layer ⇄ theme registry ⇄ DESIGN.md", () => {
  const roleNames = [...colorRoles(cssBlockTokens(":root")).keys()].sort();

  it("every registered theme set defines the same semantic roles", () => {
    for (const theme of THEME_SETS) {
      const block = colorRoles(cssBlockTokens(themeSelector(theme.id)));
      expect([...block.keys()].sort(), `${theme.id} semantic roles`).toEqual(roleNames);
    }
  });

  it("token-layer hex values match the DESIGN.md §4 palette, every theme", () => {
    for (const theme of THEME_SETS) {
      const block = cssBlockTokens(themeSelector(theme.id));
      const documented = designPaletteTable(theme.label);
      expect([...documented.keys()].sort(), `${theme.label} table documents every role`).toEqual(roleNames);
      for (const [role, hex] of documented) {
        expect(block.get(role), `${theme.label} theme: --${role}`).toBe(hex);
      }
    }
  });

  it("system themes keep the shared default look (no look-token overrides)", () => {
    for (const theme of THEME_SETS.filter((t) => t.kind === "system" && t.id !== "light")) {
      const lookOverrides = [...cssBlockTokens(themeSelector(theme.id)).keys()].filter(
        (name) => LOOK_TOKENS.has(name) && name !== "overlay-shadow",
      );
      expect(lookOverrides, `${theme.id} must not override look tokens (DESIGN §3)`).toEqual([]);
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
  const roles = new Set(colorRoles(cssBlockTokens(":root")).keys());
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
