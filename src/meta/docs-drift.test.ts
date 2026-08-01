import { describe, it } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Wraps the deterministic doc-drift guard (scripts/check-doc-drift.mjs) so it
 * also runs under `npm test`, not only in the dedicated CI step. Runs the
 * checker as a subprocess so this test stays decoupled from the .mjs module's
 * types/resolution. The checker fails (non-zero) on any drift between the docs
 * and the code they describe: the module set and barrels, the schema's tables,
 * the seam's ArtifactKind union, the API route set, and the hero's chips.
 */
describe("doc drift guard", () => {
  it("the docs stay in sync with the code they describe", () => {
    try {
      execFileSync("node", ["scripts/check-doc-drift.mjs"], { encoding: "utf8" });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(`${e.stdout ?? ""}${e.stderr ?? ""}`.trim());
    }
  });
});
