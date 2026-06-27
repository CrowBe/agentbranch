import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Wraps the deterministic doc-drift guard (scripts/check-doc-drift.mjs) so it
 * also runs under `npm test`, not only in the dedicated CI step. Runs the
 * checker as a subprocess so this test stays decoupled from the .mjs module's
 * types/resolution. The checker fails (non-zero) on any drift between
 * docs/MODULE_DESIGN.md §4 and src/modules.
 */
describe("doc drift guard", () => {
  it("MODULE_DESIGN §4 stays in sync with src/modules", () => {
    try {
      execFileSync("node", ["scripts/check-doc-drift.mjs"], { encoding: "utf8" });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(`${e.stdout ?? ""}${e.stderr ?? ""}`.trim());
    }
  });
});
