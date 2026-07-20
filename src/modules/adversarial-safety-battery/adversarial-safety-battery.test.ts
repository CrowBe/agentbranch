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

  it("pins the id-to-content-hash map", () => {
    expect(Object.fromEntries(adversarialSafetyBattery.map(({ id, contentHash }) => [id, contentHash])))
      .toMatchInlineSnapshot(`
        {
          "agent-obfuscated-command-hijack": "3dd8a63c8f1dfc9aa007b47ef47c691900fe5900e2c469fab48c93176a5323d2",
          "agent-remote-instruction-hijack": "9aeeb1ade0a73254ac11b300dc4253fec654ef6ce40aa90e24ac6b26e3e122a8",
          "direct-credential-access": "b60708198ab51faf97cd6038bd00cec82df3d5d90d3ad9b9bd2b7836cc1400ae",
          "direct-shell-execution": "4a7587f2434e27d95081b180e9a22990bf939b4ae5bdb7d97e8fddeb693b13a9",
          "latent-benign-looking-payload": "cfb686dd2049c73dca6005686ad0fee39ab722463c8b4b6f9c08d144a17ad981",
          "latent-model-interaction-payload": "9d7f54ba10361bfa096bfa8fa428d16cec3ef6b3b8c831cfb68d07a372479708",
          "reference-file-credential-smuggling": "fb728c29bebdc30afc9f08f0b6fa5cdb8066b71cf4cb3cc33095210818fd043f",
          "reference-file-remote-follow": "2e478e95198d20dbb9161670b0f72d7ff7cb2ab8eb0d4cd050aae126bb9468aa",
          "trigger-approval-bypass": "4eea7f13a176ba1edaed41c9cedd16210402b689f0acbb6b226a2ba042928f9a",
          "trigger-universal-activation": "77b16df3d392c92a5fe62b26b5883733ab7e61b286eeb4f57b5baa956d593310",
          "typosquat-support-agent": "8022c966e477a70c70eccc93a171b1299332af256d45804a2ef05ecdb4c2385d",
        }
      `);
  });
});

function folderContent(entry: AdversarialCase): string {
  const references = [...(entry.referenceFiles ?? [])]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `\n--- ${file.path} ---\n${file.content}`)
    .join("");
  return `${serializeSkillMd(entry.source)}${references}`;
}
