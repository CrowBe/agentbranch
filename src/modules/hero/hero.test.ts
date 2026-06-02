import { describe, it, expect } from "vitest";
import { heroCapability } from "./index";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(
      `---\nname: inbox-triage\ndescription: Sort the inbox.\n---\n# Goal\nClear unread mail.\n\n# Rules\nNever auto-send.`,
    ),
  );
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("hero capability", () => {
  it("rendered view exposes title, description and sections, no YAML", async () => {
    const doc = unwrap(await runCapability(heroCapability, "rendered", fixtureSkill()));
    expect(doc.title).toBe("inbox-triage");
    expect(doc.description).toBe("Sort the inbox.");
    expect(doc.sections.map((s) => s.heading)).toEqual(["Goal", "Rules"]);
    expect(JSON.stringify(doc)).not.toContain("---");
  });

  it("source view returns the raw SKILL.md including frontmatter", async () => {
    const doc = unwrap(await runCapability(heroCapability, "source", fixtureSkill()));
    expect(doc.markdown).toContain("name: inbox-triage");
    expect(doc.markdown).toContain("# Rules");
  });
});
