import { describe, expect, it } from "vitest";
import { lintCapability } from "./index";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, type SkillSource } from "@/modules/skill";
import { SkillId, unwrap, UserId } from "@/shared";

describe("lint capability", () => {
  it("returns a clean report for a spec-shaped skill", async () => {
    const report = unwrap(
      await runCapability(lintCapability, "breakdown", skillFromSource(goodSource())),
    );

    expect(report.summary).toEqual({
      score: 100,
      grade: "A",
      counts: { error: 0, warn: 0, info: 0 },
    });
    expect(report.findings).toEqual([]);
  });

  it("flags frontmatter and body structure with source spans", async () => {
    const source: SkillSource = {
      frontmatter: {
        name: "Inbox Triage!",
        description: "Sort.",
        extra: { owner: "ops" },
      },
      body: "Read the inbox and decide what needs attention.",
    };

    const report = unwrap(await runCapability(lintCapability, "breakdown", skillFromSource(source)));

    expect(report.findings.map((finding) => finding.rule)).toEqual([
      "frontmatter.name.format",
      "frontmatter.description.too-short",
      "frontmatter.unknown-key",
      "body.structure.headings",
    ]);
    expect(report.summary.counts).toEqual({ error: 0, warn: 2, info: 2 });
    expect(report.findings.every((finding) => finding.sourceSpan !== undefined)).toBe(true);
  });

  it("renders friendly insights and detailed breakdown from the same artifact", async () => {
    const insights = unwrap(
      await runCapability(lintCapability, "insights", skillFromSource({
        frontmatter: { name: "", description: "", extra: {} },
        body: "",
      })),
    );

    expect(insights.grade).toBe("D");
    expect(insights.findings).toContain("Your skill needs a frontmatter `name`.");
    expect(insights.findings).toContain(
      "Your skill needs a frontmatter `description` so agents know when to use it.",
    );
    expect(insights.findings).toContain(
      "Add instructions to the body so the skill has something to do after it triggers.",
    );
  });
});

function goodSource(): SkillSource {
  return unwrap(
    parseSkillMd(
      `---\nname: inbox-triage\ndescription: Sort unread email into clear priority buckets.\n---\n# Goal\nIdentify urgent unread messages.\n\n# Steps\n- Read the inbox.\n- Group messages by priority.\n- Draft a short summary.`,
    ),
  );
}

function skillFromSource(source: SkillSource) {
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}
