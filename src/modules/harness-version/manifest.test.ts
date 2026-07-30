import { describe, expect, it } from "vitest";
import { currentHarnessManifest, hashHarnessManifest } from "./index";
import type { HarnessManifest } from "./harness-version.types";

const manifest = currentHarnessManifest();

/** Every field except the deploy SHA is an artifact hash. */
function artifactKeys(value: HarnessManifest): readonly string[] {
  return Object.keys(value).filter((key) => key !== "gitSha");
}

describe("the harness manifest", () => {
  it("records a real hash for every artifact it claims to pin", () => {
    for (const key of artifactKeys(manifest)) {
      expect(manifest[key as keyof HarnessManifest], key).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("pins the pieces that can change a graded outcome", () => {
    // Named explicitly so adding a scoring artifact without pinning it fails
    // here rather than silently letting two harnesses share a version.
    expect([...artifactKeys(manifest)].sort()).toEqual(
      [
        "adversarialNegativeBattery",
        "buildLoopSystemPrompt",
        "distractorLibrary",
        "equipmentAuthoringPrompts",
        "lintRuleset",
        "promptBatteryGenerator",
        "responseSchemaLintRuleset",
        "safetyReviewJudge",
        "subagentDefinitionLintRuleset",
        "testRunWorldGenerator",
        "toolContractLintRuleset",
      ].sort(),
    );
  });

  it("gives a different identity when any one artifact changes", () => {
    const baseline = hashHarnessManifest(manifest);
    for (const key of artifactKeys(manifest)) {
      const changed = hashHarnessManifest({ ...manifest, [key]: "changed" } as HarnessManifest);
      expect(changed, key).not.toBe(baseline);
    }
  });

  it("is stable across calls when nothing changed", () => {
    expect(hashHarnessManifest(currentHarnessManifest())).toBe(hashHarnessManifest(manifest));
  });
});
