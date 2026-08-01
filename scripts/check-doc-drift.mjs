#!/usr/bin/env node
// Deterministic doc-drift guard. Catches the recurring failure mode where the
// code advances past what docs/MODULE_DESIGN.md claim. Zero deps so it runs in
// CI and locally (and inside the vitest wrapper at src/meta/docs-drift.test.ts).
//
// Nine falsifiable checks (no LLM judgment, no false positives by design):
//   1. module-set sync   — every src/modules/<m> has a §4 row, and vice versa.
//   2. barrel surface     — every name MODULE_DESIGN §4 lists as a module's
//                           public surface is actually exported by its index.ts.
//   3. STUB duality       — code STUB marker ⇒ §4 status admits a stub, and a
//                           §4 status "STUB" claim ⇒ the code actually has one.
//   4. stub-boundaries     — every file the "Stub boundaries" list names must
//                           actually contain a STUB marker (catches a stub that
//                           got implemented but stayed on the list — the prose-
//                           only "stub" claim a marker-based check misses).
//   5. schema tables      — prisma @@map set ⇄ the §7 data-model list.
//   6. artifact kinds     — the seam's closed ArtifactKind union ⇄ the §3 list.
//   7. api routes         — every src/app/api route handler is named in the doc.
//   8. hero chips         — the rendered chip set ⇄ ARCHITECTURE §7's chip table.
//   9. reachability       — every module/component has an import path from
//                           src/app, or is named in the "Unreached" list with a
//                           reason (a resolver nothing calls is not a feature).
//
// Semantic prose drift ("does the description still describe the code?") is out
// of scope here — that is what knip (dead exports) and the pre-commit agent
// nudge cover.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULES_DIR = join(ROOT, "src", "modules");
const DESIGN_DOC = join(ROOT, "docs", "MODULE_DESIGN.md");
const ARCH_DOC = join(ROOT, "docs", "ARCHITECTURE.md");
const SCHEMA = join(ROOT, "prisma", "schema.prisma");
const SEAM_TYPES = join(MODULES_DIR, "skill-analysis", "seam.types.ts");
const API_DIR = join(ROOT, "src", "app", "api");
const CHIPS = join(ROOT, "src", "components", "tool-chips.tsx");

/** Collect the drift findings; an empty list means the docs are in sync. */
export function findDocDrift() {
  const drift = [];
  const doc = readFileSync(DESIGN_DOC, "utf8");

  const dirModules = readdirSync(MODULES_DIR).filter((name) =>
    statSync(join(MODULES_DIR, name)).isDirectory(),
  );
  const rows = parseDomainTable(doc);
  const documented = new Set(rows.map((r) => r.module));

  // 1. module-set sync ------------------------------------------------------
  for (const mod of dirModules) {
    if (!documented.has(mod)) {
      drift.push(`MODULE_DESIGN §4 is missing a row for module \`${mod}\` (folder exists, doc doesn't list it).`);
    }
  }
  for (const mod of documented) {
    if (!dirModules.includes(mod)) {
      drift.push(`MODULE_DESIGN §4 documents module \`${mod}\`, but src/modules/${mod} does not exist.`);
    }
  }

  // 2. barrel surface (documented names ⊆ real exports) ---------------------
  for (const row of rows) {
    if (!dirModules.includes(row.module)) continue;
    const exports = parseExports(readFileSync(join(MODULES_DIR, row.module, "index.ts"), "utf8"));
    for (const name of surfaceNames(row.surface)) {
      if (!exports.has(name)) {
        drift.push(`MODULE_DESIGN §4 lists \`${name}\` as ${row.module}'s public surface, but ${row.module}/index.ts does not export it.`);
      }
    }
  }

  // 3. STUB duality (anchored to the §4 status cell) ------------------------
  for (const row of rows) {
    if (!dirModules.includes(row.module)) continue;
    const sourceHasStub = moduleHasStubMarker(join(MODULES_DIR, row.module));
    const statusClaimsStub = /\bSTUB\b/.test(row.status);
    const statusAdmitsStub = /stub/i.test(row.status);

    if (sourceHasStub && !statusAdmitsStub) {
      drift.push(`Module \`${row.module}\` has a STUB marker in its source, but MODULE_DESIGN §4 status does not mention a stub ("${row.status.trim()}").`);
    }
    if (statusClaimsStub && !sourceHasStub) {
      drift.push(`MODULE_DESIGN §4 claims a \`STUB\` in-file for \`${row.module}\`, but no STUB marker exists in src/modules/${row.module}.`);
    }
  }

  // 4. stub-boundaries integrity (every listed file must really be a stub) ---
  for (const path of parseStubBoundaries(doc)) {
    const full = join(MODULES_DIR, path);
    if (!pathExists(full)) {
      drift.push(`MODULE_DESIGN stub-boundaries lists \`${path}\`, but src/modules/${path} does not exist.`);
    } else if (!readFileSync(full, "utf8").includes("STUB")) {
      drift.push(`MODULE_DESIGN stub-boundaries lists \`${path}\` as a placeholder, but it has no STUB marker — implement-and-delist it, or mark it per §6.`);
    }
  }

  // 5. schema tables (prisma @@map ⇄ the §7 data-model list) ------------------
  const mapped = new Set(
    [...readFileSync(SCHEMA, "utf8").matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]),
  );
  const listed = new Set(parseSchemaList(doc));
  for (const table of mapped) {
    if (!listed.has(table)) {
      drift.push(`prisma/schema.prisma defines table \`${table}\`, but MODULE_DESIGN §7's data-model list does not name it.`);
    }
  }
  for (const table of listed) {
    if (!mapped.has(table)) {
      drift.push(`MODULE_DESIGN §7 lists table \`${table}\`, but prisma/schema.prisma has no @@map for it.`);
    }
  }

  // 6. ArtifactKind union (the seam's closed union ⇄ the §3 bullet) ----------
  const kinds = parseArtifactKinds();
  const documentedKinds = new Set(parseDocumentedArtifactKinds(doc));
  for (const kind of kinds) {
    if (!documentedKinds.has(kind)) {
      drift.push(`ArtifactKind includes "${kind}", but MODULE_DESIGN §3's ArtifactKind list does not.`);
    }
  }
  for (const kind of documentedKinds) {
    if (!kinds.includes(kind)) {
      drift.push(`MODULE_DESIGN §3 lists ArtifactKind "${kind}", but the union in skill-analysis does not include it.`);
    }
  }

  // 7. API routes (every route handler is named somewhere in MODULE_DESIGN) --
  const documentedRoutes = parseDocumentedRoutes(doc);
  for (const route of apiRoutes()) {
    const covered = documentedRoutes.some(
      (mention) => mention === route || route.startsWith(`${mention}/`),
    );
    if (!covered) {
      drift.push(`Route \`${route}/route.ts\` exists, but MODULE_DESIGN does not mention it.`);
    }
  }

  // 8. hero chips (the rendered chip set ⇄ the ARCHITECTURE §7 chip table) ---
  const chips = parseChipLabels();
  const documentedChips = new Set(parseDocumentedChips(readFileSync(ARCH_DOC, "utf8")));
  for (const chip of chips) {
    if (!documentedChips.has(chip)) {
      drift.push(`The hero renders a "${chip}" chip, but ARCHITECTURE §7's chip table does not list it.`);
    }
  }
  for (const chip of documentedChips) {
    if (!chips.includes(chip)) {
      drift.push(`ARCHITECTURE §7's chip table lists a "${chip}" chip, but the hero does not render it.`);
    }
  }

  // 9. reachability (built ⇄ reachable, or listed as known debt) ------------
  // A resolver nothing calls is not a capability. This is the check that
  // catches domain code landing without the surface that makes it real.
  const { modules: unreachedModules, components: unreachedComponents } = unreachedFromApp();
  const declared = new Set(parseUnreached(doc));
  for (const name of [...unreachedModules, ...unreachedComponents]) {
    if (!declared.has(name)) {
      drift.push(`\`${name}\` is built but nothing in src/app reaches it, and MODULE_DESIGN's "Unreached" list does not name it — wire it up, or record it there with the reason.`);
    }
  }
  for (const name of declared) {
    if (!unreachedModules.includes(name) && !unreachedComponents.includes(name)) {
      drift.push(`MODULE_DESIGN's "Unreached" list names \`${name}\`, but src/app reaches it now — delete the entry.`);
    }
  }

  return drift;
}

/**
 * Domain modules and components with no import path from `src/app`. Follows
 * `@/` and relative specifiers through the real files, so a module reached
 * only via a barrel re-export still counts as linked.
 */
function unreachedFromApp() {
  const files = [];
  const walk = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) files.push(full);
    }
  };
  for (const dir of ["app", "server", "components", "infra", "modules"]) walk(join(ROOT, "src", dir));

  const candidates = (spec, from) => {
    let base;
    if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = join(from, "..", spec);
    else return [];
    return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].filter((f) => files.includes(f));
  };

  const seen = new Set();
  const queue = files.filter((f) => f.startsWith(join(ROOT, "src", "app")));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specs = [
      ...[...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]),
    ];
    for (const spec of specs) for (const target of candidates(spec, file)) queue.push(target);
  }

  const reached = [...seen];
  const modules = readdirSync(MODULES_DIR)
    .filter((name) => statSync(join(MODULES_DIR, name)).isDirectory())
    .filter((name) => !reached.some((f) => f.startsWith(join(MODULES_DIR, name) + "/")));
  const components = files
    .filter((f) => f.startsWith(join(ROOT, "src", "components")) && !seen.has(f))
    .map((f) => f.slice(ROOT.length + 1));
  return { modules, components };
}

/** Entries of the "Unreached" list — things built but not yet wired up. */
function parseUnreached(doc) {
  const start = doc.indexOf("**Unreached");
  if (start === -1) return [];
  const rest = doc.slice(start);
  const end = rest.indexOf("\n**", 3);
  const section = rest.slice(0, end === -1 ? undefined : end);
  return [...section.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
}

/** Table names in the §7 "Data model lives in `prisma/schema.prisma`" bullet. */
function parseSchemaList(doc) {
  const start = doc.indexOf("Data model lives in");
  if (start === -1) throw new Error("Could not find the §7 data-model list in MODULE_DESIGN.md");
  const section = doc.slice(start, doc.indexOf("\n- ", start + 1));
  return [...section.matchAll(/`([a-z_]+)`/g)]
    .map((m) => m[1])
    .filter((name) => name.includes("_") || !name.includes("."));
}

function parseArtifactKinds() {
  const source = readFileSync(SEAM_TYPES, "utf8");
  const start = source.indexOf("export type ArtifactKind =");
  if (start === -1) throw new Error("Could not find the ArtifactKind union.");
  const union = source.slice(start, source.indexOf(";", start));
  return [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

function parseDocumentedArtifactKinds(doc) {
  const start = doc.indexOf("**`ArtifactKind`**");
  if (start === -1) throw new Error("Could not find the ArtifactKind bullet in MODULE_DESIGN.md");
  const bullet = doc.slice(start, doc.indexOf("\n- ", start + 1));
  return [...bullet.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

/** Route directories under src/app/api, relative to src (e.g. `app/api/import`). */
function apiRoutes() {
  const routes = [];
  const walk = (dir, prefix) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full, `${prefix}/${item.name}`);
      else if (item.name === "route.ts") routes.push(prefix);
    }
  };
  walk(API_DIR, "app/api");
  return routes.sort();
}

/**
 * Route paths MODULE_DESIGN names. Brace groups (`{test-run,triggering-eval}`)
 * expand, and a trailing ellipsis means "this subtree", so naming a parent
 * covers its children.
 */
function parseDocumentedRoutes(doc) {
  const mentions = [];
  for (const m of doc.matchAll(/`([^`]*app\/api\/[^`]*)`/g)) {
    for (const expanded of expandBraces(m[1])) {
      const path = expanded
        .replace(/\/route\.ts$/, "")
        .replace(/\/(?:…|\.\.\.)$/, "")
        .replace(/[)\s].*$/, "")
        .trim();
      if (path.startsWith("app/api")) mentions.push(path);
    }
  }
  return mentions;
}

function expandBraces(value) {
  const match = /\{([^}]*)\}/.exec(value);
  if (!match) return [value];
  return match[1]
    .split(",")
    .flatMap((option) =>
      expandBraces(value.slice(0, match.index) + option.trim() + value.slice(match.index + match[0].length)),
    );
}

function parseChipLabels() {
  const source = readFileSync(CHIPS, "utf8");
  const start = source.indexOf("const CHIPS");
  if (start === -1) throw new Error("Could not find the CHIPS list in tool-chips.tsx");
  const list = source.slice(start, source.indexOf("];", start));
  return [...list.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function parseDocumentedChips(archDoc) {
  const start = archDoc.indexOf("| Chip | Backed by |");
  if (start === -1) throw new Error("Could not find the chip table in ARCHITECTURE.md");
  const table = archDoc.slice(start, archDoc.indexOf("\n\n", start));
  return [...table.matchAll(/^\s*\|\s*\*\*([^*]+)\*\*\s*\|/gm)].map((m) => m[1].trim());
}

/** Rows of the "### Domain (`src/modules`)" table: { module, surface, status }. */
function parseDomainTable(doc) {
  const start = doc.indexOf("### Domain");
  if (start === -1) throw new Error("Could not find the '### Domain' table in MODULE_DESIGN.md");
  const after = doc.indexOf("\n### ", start + 1);
  const slice = doc.slice(start, after === -1 ? undefined : after);

  const rows = [];
  for (const line of slice.split("\n")) {
    const match = /^\|\s*\*\*([a-z0-9-]+)\*\*\s*\|/.exec(line);
    if (!match) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells: ["", "**mod**", surface, ports, status, ""]
    rows.push({ module: match[1], surface: cells[2] ?? "", status: cells[4] ?? "" });
  }
  return rows;
}

/** File paths (relative to src/modules) named in the "Stub boundaries" list. */
function parseStubBoundaries(doc) {
  const start = doc.indexOf("**Stub boundaries");
  if (start === -1) return [];
  const rest = doc.slice(start);
  const end = rest.indexOf("\n**", 3); // next bold heading after this one bounds the list
  const section = rest.slice(0, end === -1 ? undefined : end);

  const paths = [];
  for (const m of section.matchAll(/^- `([^`]+)`/gm)) {
    if (m[1].includes("/")) paths.push(m[1]); // a module-relative file path, not a bare term
  }
  return paths;
}

function pathExists(full) {
  try {
    statSync(full);
    return true;
  } catch {
    return false;
  }
}

/** Backticked, identifier-shaped names from a surface cell (drops shorthands/prose).
 *  Parenthesised groups are method lists on a type — e.g. `ModelGateway`
 *  (`classify`/`runAgent`) — not separate exports, so strip them first. */
function surfaceNames(cell) {
  const names = [];
  const topLevel = cell.replace(/\([^)]*\)/g, "");
  for (const m of topLevel.matchAll(/`([^`]+)`/g)) {
    const token = m[1];
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(token)) names.push(token);
  }
  return names;
}

/** Names a barrel exposes: named (re-)export blocks + `export <decl> name`. */
function parseExports(source) {
  const names = new Set();
  for (const block of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      // Drop inline `type` modifier and any `X as Y` rename (the bound name wins).
      const token = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (token) names.add(token);
    }
  }
  for (const decl of source.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) {
    names.add(decl[1]);
  }
  return names;
}

function moduleHasStubMarker(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (moduleHasStubMarker(full)) return true;
    } else if (entry.name.endsWith(".ts") && readFileSync(full, "utf8").includes("STUB")) {
      return true;
    }
  }
  return false;
}

// CLI entry: print findings, exit non-zero on drift.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const drift = findDocDrift();
  if (drift.length === 0) {
    console.log("✓ No doc drift: the docs match src/modules, the schema, the seam, the routes, and the chips.");
    process.exit(0);
  }
  console.error(`✗ Found ${drift.length} doc-drift issue(s):\n`);
  for (const d of drift) console.error(`  • ${d}`);
  console.error("\nUpdate docs/MODULE_DESIGN.md (and the code) so they read as current state.");
  process.exit(1);
}
