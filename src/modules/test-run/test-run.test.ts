import { describe, it, expect } from "vitest";
import { executeSkill, defaultMockToolRegistry } from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(): Skill {
  const source = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

describe("test run", () => {
  it("produces a transcript that calls each mock tool and touches nothing real", async () => {
    const registry = defaultMockToolRegistry();
    const transcript = unwrap(
      await executeSkill({
        skill: fixtureSkill(),
        scenario: { prompt: "Clear my inbox", seedData: {} },
        registry,
      }),
    );
    expect(transcript.some((s) => s.kind === "tool-call" && s.tool === "read_email")).toBe(true);
    expect(transcript.some((s) => s.kind === "tool-result")).toBe(true);
    expect(transcript.at(-1)).toEqual({
      kind: "model",
      text: "Drafted a response. Nothing real was touched.",
    });
  });
});
