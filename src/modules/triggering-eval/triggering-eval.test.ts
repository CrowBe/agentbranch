import { describe, it, expect } from "vitest";
import { runTriggeringEval, buildPromptBattery } from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { unwrap, SkillId, UserId } from "@/shared";

function skillFor(description: string): Skill {
  const source = unwrap(parseSkillMd(`---\nname: t\ndescription: ${description}\n---\nbody`));
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("triggering eval", () => {
  it("builds a battery with both positive and negative cases", () => {
    const battery = buildPromptBattery(skillFor("Schedule meetings on the calendar."));
    expect(battery.some((c) => c.expected === "fire")).toBe(true);
    expect(battery.some((c) => c.expected === "silent")).toBe(true);
  });

  it("returns a pass/fail result over every case", async () => {
    const result = unwrap(await runTriggeringEval(skillFor("Schedule meetings on the calendar.")));
    expect(result.cases).toHaveLength(4);
    expect(typeof result.passed).toBe("boolean");
    for (const c of result.cases) {
      expect(["fire", "silent"]).toContain(c.actual);
    }
  });
});
