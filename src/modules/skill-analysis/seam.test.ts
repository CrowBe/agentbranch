import { describe, it, expect } from "vitest";
import { defineCapability, runCapability } from "./seam";
import type { Artifact, Analyzer, Renderer } from "./seam.types";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import { ok, unwrap, SkillId, UserId } from "@/shared";

type WordCount = Artifact<"word-count"> & { readonly count: number };

function fixtureSkill(): Skill {
  const source = unwrap(
    parseSkillMd(`---\nname: t\ndescription: d\n---\nalpha beta gamma`),
  );
  return makeSkill({
    id: SkillId("s1"),
    userId: UserId("u1"),
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

const analyzer: Analyzer<WordCount> = {
  kind: "word-count",
  async analyze(skill) {
    return ok({ kind: "word-count", count: skill.source.body.split(/\s+/).length });
  },
};

const text: Renderer<WordCount, string> = {
  target: "text",
  render: (a) => `${a.count} words`,
};

describe("the seam", () => {
  it("runs analyze → render through one pipeline", async () => {
    const cap = defineCapability({
      name: "word-count",
      analyzer,
      renderers: { text },
    });
    const result = await runCapability(cap, "text", fixtureSkill());
    expect(unwrap(result)).toBe("3 words");
  });
});
