import { describe, it, expect } from "vitest";
import { runTriggeringEval, buildPromptBattery } from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import { ok, unwrap, SkillId, UserId } from "@/shared";

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

/**
 * A deterministic fake gateway: selects the candidate (the first choice, which
 * runTriggeringEval builds as the skill's own label) when the prompt shares a
 * keyword with it, else null. Stands in for the model so the eval is testable
 * offline — exercises the evaluator's *method*, not the model.
 */
function fakeGateway(): ModelGateway {
  return {
    hasModel: true,
    async classify({ prompt, choices }) {
      const candidate = choices[0] ?? "";
      const words = new Set(candidate.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4));
      const fires = prompt
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => words.has(w));
      return ok({ choice: fires ? candidate : null, rationale: "probe" });
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async generate({ schema }) {
      // Validate a canned insight through the caller's schema so the generic
      // return type is honoured — same contract the real adapter satisfies.
      return ok(
        schema.parse({
          verdict: "good",
          summary: "Fires on the right prompts.",
          findings: ["targets its keyword"],
          watch: [],
        }),
      );
    },
  };
}

const TAG = { kind: "account" as const, userId: UserId("u1"), capability: "triggering-eval" as const };

describe("triggering eval", () => {
  it("builds a battery with both positive and negative cases", () => {
    const battery = buildPromptBattery(skillFor("Schedule meetings on the calendar."));
    expect(battery.some((c) => c.expected === "fire")).toBe(true);
    expect(battery.some((c) => c.expected === "silent")).toBe(true);
  });

  it("returns a pass/fail artifact over every case, composed via classify", async () => {
    const result = unwrap(
      await runTriggeringEval(skillFor("Schedule meetings on the calendar."), fakeGateway(), TAG),
    );
    expect(result.kind).toBe("triggering-eval");
    expect(result.cases).toHaveLength(4);
    expect(typeof result.passed).toBe("boolean");
    for (const c of result.cases) {
      expect(["fire", "silent"]).toContain(c.actual);
      expect(typeof c.rationale).toBe("string");
    }
    // The evaluator populates a plain-language Insight from generate().
    expect(["good", "needs-attention", "failing"]).toContain(result.insight.verdict);
    expect(typeof result.insight.summary).toBe("string");
  });

  it("fires on a matching prompt and stays silent on an unrelated one", async () => {
    const result = unwrap(
      await runTriggeringEval(skillFor("Schedule meetings on the calendar."), fakeGateway(), TAG),
    );
    const positives = result.cases.filter((c) => c.expected === "fire");
    const negatives = result.cases.filter((c) => c.expected === "silent");
    expect(positives.every((c) => c.actual === "fire")).toBe(true);
    expect(negatives.every((c) => c.actual === "silent")).toBe(true);
  });
});
