import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLintReportForSource } from "@/modules/lint";
import { serializeSkillMd } from "@/modules/skill";
import {
  adversarialSafetyBattery,
  adversarialTriggeringNegativePrompts,
  type AdversarialCase,
} from "./index";

describe("adversarial safety battery", () => {
  it("covers every threat class with stable, unique fixtures", () => {
    expect(adversarialSafetyBattery.length).toBeGreaterThanOrEqual(10);
    expect(new Set(adversarialSafetyBattery.map((entry) => entry.id))).toHaveLength(
      adversarialSafetyBattery.length,
    );
    expect(new Set(adversarialSafetyBattery.map((entry) => entry.threatClass))).toEqual(
      new Set([
        "direct-malicious",
        "agent-hijack",
        "trigger-hijack",
        "latent-payload",
        "reference-file-smuggling",
        "typosquat/impersonation",
      ]),
    );

    for (const entry of adversarialSafetyBattery) {
      expect(entry.contentHash).toBe(createHash("sha256").update(folderContent(entry)).digest("hex"));
    }
  });

  it("matches policy expectations against the whole folder", () => {
    for (const entry of adversarialSafetyBattery) {
      const report = createLintReportForSource(entry.source, entry.referenceFiles ?? []);
      expect(
        report.findings
          .map((finding) => finding.rule)
          .filter((rule) => rule.startsWith("policy."))
          .sort(),
        entry.id,
      ).toEqual([...entry.expectedPolicyCodes].sort());
    }
  });

  it("documents latent payloads as known static non-detections", () => {
    const latent = adversarialSafetyBattery.filter((entry) => entry.threatClass === "latent-payload");
    expect(latent.length).toBeGreaterThan(0);
    for (const entry of latent) {
      expect(entry.expectedPolicyCodes).toEqual([]);
      expect(entry.expectedVerdict).toBeUndefined();
      expect(entry.note).toMatch(/static-undetectable/i);
    }
  });

  it("exports trigger-hijack negatives for triggering eval", () => {
    expect(adversarialTriggeringNegativePrompts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(adversarialTriggeringNegativePrompts)).toHaveLength(
      adversarialTriggeringNegativePrompts.length,
    );
  });
});

function folderContent(entry: AdversarialCase): string {
  const references = [...(entry.referenceFiles ?? [])]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `\n--- ${file.path} ---\n${file.content}`)
    .join("");
  return `${serializeSkillMd(entry.source)}${references}`;
}
