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

  it("flags local reference links that do not match known skill files", async () => {
    const report = unwrap(
      await runCapability(
        lintCapability,
        "breakdown",
        skillFromSource({
          frontmatter: {
            name: "research-helper",
            description: "Use project reference files to answer research questions.",
            extra: {},
          },
          body: "# Steps\nRead [known](references/known.md), [missing](references/missing.md), and [docs](https://example.com/docs).",
        }),
        { referenceFiles: ["references/known.md"] },
      ),
    );

    expect(report.findings.map((finding) => finding.rule)).toEqual([
      "body.reference-file.missing",
    ]);
    expect(report.findings[0]).toMatchObject({
      message: "Local reference link `references/missing.md` does not match a known skill file.",
      sourceSpan: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
    });
  });

  it("warns when the body token footprint is high", async () => {
    const report = unwrap(
      await runCapability(
        lintCapability,
        "breakdown",
        skillFromSource({
          frontmatter: {
            name: "long-skill",
            description: "Handle a long workflow that should be split into references.",
            extra: {},
          },
          body: `# Steps\n${"word ".repeat(4500)}`,
        }),
      ),
    );

    expect(report.findings.map((finding) => finding.rule)).toEqual(["body.token-footprint"]);
    expect(report.summary.counts).toEqual({ error: 0, warn: 1, info: 0 });
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
