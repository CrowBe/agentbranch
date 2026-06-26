#!/usr/bin/env node
// Deterministic doc-drift guard. Catches the recurring failure mode where the
// code advances past what docs/MODULE_DESIGN.md claim. Zero deps so it runs in
// CI and locally (and inside the vitest wrapper at src/meta/docs-drift.test.ts).
//
// Three falsifiable checks (no LLM judgment, no false positives by design):
//   1. module-set sync   — every src/modules/<m> has a §4 row, and vice versa.
//   2. barrel surface     — every name MODULE_DESIGN §4 lists as a module's
//                           public surface is actually exported by its index.ts.
//   3. STUB duality       — code STUB marker ⇒ docs acknowledge a stub, and a
//                           doc "STUB in-file" claim ⇒ the code actually has one.
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

  // 3. STUB duality ---------------------------------------------------------
  for (const row of rows) {
    if (!dirModules.includes(row.module)) continue;
    const sourceHasStub = moduleHasStubMarker(join(MODULES_DIR, row.module));
    const docClaimsStub = /\bSTUB\b/.test(moduleDocText(doc, row));
    const statusAdmitsStub = /stub/i.test(row.status);

    if (sourceHasStub && !statusAdmitsStub) {
      drift.push(`Module \`${row.module}\` has a STUB marker in its source, but MODULE_DESIGN §4 status does not mention a stub ("${row.status.trim()}").`);
    }
    if (docClaimsStub && !sourceHasStub) {
      drift.push(`MODULE_DESIGN claims a \`STUB\` in-file for \`${row.module}\`, but no STUB marker exists in src/modules/${row.module}.`);
    }
  }

  return drift;
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

/** The doc text relevant to a module: its §4 status cell + any stub-boundary bullet. */
function moduleDocText(doc, row) {
  const bullet = new RegExp(`^- \`${row.module}/[^\`]+\`[^\\n]*`, "m").exec(doc);
  return `${row.status}\n${bullet ? bullet[0] : ""}`;
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
    console.log("✓ No doc drift: MODULE_DESIGN §4 is in sync with src/modules.");
    process.exit(0);
  }
  console.error(`✗ Found ${drift.length} doc-drift issue(s):\n`);
  for (const d of drift) console.error(`  • ${d}`);
  console.error("\nUpdate docs/MODULE_DESIGN.md (and the code) so they read as current state.");
  process.exit(1);
}
