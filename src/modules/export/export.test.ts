import { describe, it, expect } from "vitest";
import { exportCapability } from "./index";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, parseSkillMd as parse, type Skill } from "@/modules/skill";
import { unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(parse(`---\nname: Inbox Triage\ndescription: d\n---\n# Body`));
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("export capability", () => {
  it("renders a standard skill-folder manifest", async () => {
    const manifest = unwrap(await runCapability(exportCapability, "standard", fixtureSkill()));
    expect(manifest.target).toBe("standard");
    expect(manifest.rootDir).toBe("inbox-triage");
    expect(manifest.files[0]!.path).toBe("inbox-triage/SKILL.md");
    // round-trips back to a valid skill
    expect(parseSkillMd(manifest.files[0]!.contents).ok).toBe(true);
  });

  it("rejects exports that would violate SKILL.md frontmatter requirements", async () => {
    const invalid = makeSkill({
      id: SkillId("s1"),
      userId: UserId("u1"),
      source: {
        frontmatter: { name: "   ", description: "d", extra: {} },
        body: "# Body",
      },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await runCapability(exportCapability, "standard", invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.tag).toBe("seam_analyze_failed");
      expect(result.error.message).toContain("Frontmatter is missing a `name`.");
    }
  });
});
