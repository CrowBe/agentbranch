import { describe, it, expect } from "vitest";
import { visualiseCapability } from "./index";
import { runCapability } from "@/modules/skill-analysis";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(
      `---\nname: t\ndescription: d\n---\n# Fetch mail\n# Never auto-send\n# Summarise`,
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

describe("visualise capability", () => {
  it("renders a Mermaid flowchart with start/end and a constraint node", async () => {
    const out = unwrap(await runCapability(visualiseCapability, "mermaid", fixtureSkill()));
    expect(out.mermaid).toMatch(/^flowchart TD/);
    expect(out.mermaid).toContain("([Triggered])");
    expect(out.mermaid).toContain("([Done])");
    // constraint nodes use the /.../ shape
    expect(out.mermaid).toContain("[/Never auto-send/]");
    expect(out.mermaid).toContain("-->");
  });
});
