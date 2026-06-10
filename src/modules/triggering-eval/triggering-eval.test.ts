import { describe, it, expect } from "vitest";
import { runTriggeringEval, buildPromptBattery, generatePromptBattery } from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { GenerateInput, ModelGateway } from "@/modules/model-gateway";
import { domainError, err, ok, unwrap, SkillId, UserId } from "@/shared";

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
type FakeGatewayOptions = {
  readonly generatedBattery?: {
    readonly positive: readonly string[];
    readonly negative: readonly string[];
  };
  readonly generateCalls?: GenerateInput<unknown>[];
  readonly rationale?: string;
};

function fakeGateway(options: FakeGatewayOptions = {}): ModelGateway {
  return {
    hasModel: true,
    async classify({ prompt, choices }) {
      const candidate = choices[0] ?? "";
      const words = new Set(candidate.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4));
      const fires = prompt
        .toLowerCase()
        .split(/[^a-z]+/)
        .some((w) => words.has(w));
      return ok({ choice: fires ? candidate : null, rationale: options.rationale ?? "probe" });
    },
    async streamAgent() {
      // The build loop's primitive; unused by the triggering-eval evaluator.
      async function* empty() {}
      return ok(empty());
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async generate(input) {
      options.generateCalls?.push(input as GenerateInput<unknown>);
      if (input.prompt.includes("Return 3 positive prompts and 3 negative prompts.")) {
        const parsed = input.schema.safeParse(
          options.generatedBattery ?? {
            positive: [
              "Schedule a planning meeting on my calendar.",
              "Find calendar time for a customer call next week.",
              "Move my calendar block to Friday.",
            ],
            negative: [
              "Summarize the notes from my meeting.",
              "Write a follow-up email after the call.",
              "What is the weather like tomorrow?",
            ],
          },
        );
        return parsed.success
          ? ok(parsed.data)
          : err(domainError("seam_analyze_failed", "Generated prompt battery was invalid."));
      }
      // Validate a canned insight through the caller's schema so the generic
      // return type is honoured — same contract the real adapter satisfies.
      return ok(
        input.schema.parse({
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
    const generateCalls: GenerateInput<unknown>[] = [];
    const result = unwrap(
      await runTriggeringEval(
        skillFor("Schedule meetings on the calendar."),
        fakeGateway({ generateCalls }),
        TAG,
      ),
    );
    expect(result.kind).toBe("triggering-eval");
    expect(result.cases).toHaveLength(6);
    expect(typeof result.passed).toBe("boolean");
    for (const c of result.cases) {
      expect(["fire", "silent"]).toContain(c.actual);
      expect(typeof c.rationale).toBe("string");
    }
    // The evaluator populates a plain-language Insight from generate().
    expect(generateCalls).toHaveLength(2);
    expect(generateCalls[0]?.tag).toEqual(TAG);
    expect(generateCalls[0]?.prompt).toContain("Return 3 positive prompts");
    expect(["good", "needs-attention", "failing"]).toContain(result.insight.verdict);
    expect(typeof result.insight.summary).toBe("string");
  });

  it("emits per-case progress while evaluating the battery", async () => {
    const progress: { index: number; total: number; prompt: string; pass: boolean }[] = [];
    const result = unwrap(
      await runTriggeringEval(
        skillFor("Schedule meetings on the calendar."),
        fakeGateway(),
        TAG,
        {
          onCase: ({ index, total, result: item }) => {
            progress.push({ index, total, prompt: item.prompt, pass: item.pass });
          },
        },
      ),
    );

    expect(progress).toHaveLength(result.cases.length);
    expect(progress[0]).toEqual({
      index: 1,
      total: result.cases.length,
      prompt: result.cases[0]?.prompt,
      pass: result.cases[0]?.pass,
    });
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

  it("generates and caches the prompt battery per skill version", async () => {
    const generateCalls: GenerateInput<unknown>[] = [];
    const skill = skillFor("Coordinate calendar bookings for workshops.");
    const gateway = fakeGateway({ generateCalls });

    const first = unwrap(await generatePromptBattery(skill, gateway, TAG));
    const second = unwrap(await generatePromptBattery(skill, gateway, TAG));

    expect(first).toEqual(second);
    expect(first).toContainEqual({
      prompt: "Schedule a planning meeting on my calendar.",
      expected: "fire",
    });
    expect(first).toContainEqual({
      prompt: "Summarize the notes from my meeting.",
      expected: "silent",
    });
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.tag).toEqual(TAG);
  });

  it("bounds generated prompt cases and clamps rationales before insight generation", async () => {
    const generateCalls: GenerateInput<unknown>[] = [];
    const longRationale = "because ".repeat(200);
    const result = unwrap(
      await runTriggeringEval(
        skillFor("Schedule meetings on the calendar."),
        fakeGateway({ generateCalls, rationale: longRationale }),
        TAG,
      ),
    );

    expect(result.cases[0]?.rationale).toBe(longRationale);
    const insightPrompt = generateCalls.at(-1)?.prompt ?? "";
    expect(insightPrompt).not.toContain(longRationale);
    expect(insightPrompt).toContain(longRationale.slice(0, 120));

    const overlongBattery = fakeGateway({
      generatedBattery: {
        positive: ["a".repeat(161), "Schedule a planning meeting."],
        negative: ["Summarize the notes.", "What is the weather?"],
      },
    });
    const rejected = await generatePromptBattery(skillFor("Coordinate workshops."), overlongBattery, TAG);
    expect(rejected.ok).toBe(false);
  });
});
