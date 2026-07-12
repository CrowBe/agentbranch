import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { baselineDistractors, baselineSkillCorpus } from "./index";
import { createLintReportForSource } from "@/modules/lint";
import { parseSkillMd, serializeSkillMd } from "@/modules/skill";
import { unwrap } from "@/shared";

describe("baseline skill corpus", () => {
  it("ships the curated corpus with stable hashes and prompt batteries", () => {
    expect(baselineSkillCorpus).toHaveLength(20);
    expect(new Set(baselineSkillCorpus.map((entry) => entry.id))).toHaveLength(20);

    for (const entry of baselineSkillCorpus) {
      expect(entry.version).toBe(1);
      expect(entry.provenance.authoringTool).toContain("skill-creator");
      expect(entry.contentHash).toBe(createHash("sha256").update(entry.source).digest("hex"));
      expect(entry.promptBattery.filter((item) => item.expected === "fire")).toHaveLength(3);
      expect(entry.promptBattery.filter((item) => item.expected === "silent")).toHaveLength(3);
    }
  });

  it("keeps every corpus skill as a parseable, lint-clean SKILL.md fixture", () => {
    for (const entry of baselineSkillCorpus) {
      const source = unwrap(parseSkillMd(entry.source));

      expect(source.frontmatter.name).toBe(entry.name);
      expect(source.frontmatter.description).toBe(entry.description);
      expect(unwrap(parseSkillMd(serializeSkillMd(source)))).toEqual(source);

      const report = createLintReportForSource(source);
      expect(report.summary.counts.error).toBe(0);
      expect(report.summary.counts.warn).toBe(0);
    }
  });

  it("feeds the triggering-eval distractor library from the corpus metadata", () => {
    expect(baselineDistractors).toEqual(
      baselineSkillCorpus.map(({ name, description }) => ({ name, description })),
    );
  });
});
