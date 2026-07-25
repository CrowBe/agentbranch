import { describe, it, expect } from "vitest";
import {
  runTriggeringEval,
  runBatteryCases,
  generatePromptBattery,
  type PromptCase,
  type SelectionCaseResult,
} from "./index";
import { buildPromptBattery } from "./prompt-battery";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { GenerateInput, ModelGateway } from "@/modules/model-gateway";
import type { EvaluationRunEvent } from "@/modules/skill-analysis";
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
  it("grades generated JSON output deterministically against the expected schema", async () => {
    const generateCalls: GenerateInput<unknown>[] = [];
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async generate(input) {
        generateCalls.push(input as GenerateInput<unknown>);
        return ok(input.schema.parse({ count: 3 }));
      },
    };
    const cases = unwrap(await runBatteryCases(
      { name: "t", description: "count records" },
      [{
        grader: "json-output",
        graderVersion: 1,
        prompt: "Return the record count.",
        expectedSchema: {
          type: "object",
          properties: { count: { type: "integer" } },
          required: ["count"],
          additionalProperties: false,
        },
      }],
      gateway,
      TAG,
    ));

    expect(generateCalls).toHaveLength(1);
    expect(cases).toEqual([expect.objectContaining({
      grader: "json-output",
      pass: true,
      observed: {
        grader: "json-output",
        output: { count: 3 },
        validationIssues: [],
      },
    })]);
  });

  it("keeps a live JSON-output run out of selection-only comparison metadata", async () => {
    let generateCalls = 0;
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async generate(input) {
        generateCalls += 1;
        return generateCalls === 1
          ? ok(input.schema.parse({ count: 3 }))
          : ok(input.schema.parse({
              verdict: "good",
              summary: "JSON matched.",
              findings: [],
              watch: [],
            }));
      },
    };
    const result = unwrap(await runTriggeringEval(
      skillFor("Return record counts."),
      gateway,
      TAG,
      {
        battery: [{
          grader: "json-output",
          graderVersion: 1,
          prompt: "Return the record count.",
          expectedSchema: {
            type: "object",
            properties: { count: { type: "integer" } },
            required: ["count"],
          },
        }],
      },
    ));
    expect(result.passed).toBe(true);
    expect(result.comparisonMetadata).toBeUndefined();
    expect(generateCalls).toBe(2);
  });

  it("decides repeated JSON-output grading by strict majority", async () => {
    const outputs = [{ count: 3 }, { count: "wrong" }, { count: 4 }];
    let calls = 0;
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async generate(input) {
        return ok(input.schema.parse(outputs[calls++]));
      },
    };
    const cases = unwrap(await runBatteryCases(
      { name: "t", description: "count records" },
      [{
        grader: "json-output",
        graderVersion: 1,
        prompt: "Return the record count.",
        expectedSchema: {
          type: "object",
          properties: { count: { type: "integer" } },
          required: ["count"],
        },
      }],
      gateway,
      TAG,
      { attempts: 3 },
    ));
    expect(calls).toBe(3);
    expect(cases[0]).toMatchObject({
      grader: "json-output",
      pass: true,
      attempts: 3,
      passedAttempts: 2,
      passRate: 2 / 3,
      observed: { grader: "json-output", output: { count: 3 }, validationIssues: [] },
    });
  });

  it("emits no JSON-output case event when a middle attempt fails", async () => {
    const events: EvaluationRunEvent[] = [];
    let calls = 0;
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async generate(input) {
        calls += 1;
        return calls === 2
          ? err(domainError("seam_analyze_failed", "middle attempt failed"))
          : ok(input.schema.parse({ count: 3 }));
      },
    };
    const result = await runBatteryCases(
      { name: "t", description: "count records" },
      [{
        grader: "json-output",
        graderVersion: 1,
        prompt: "Return the record count.",
        expectedSchema: { type: "object" },
      }],
      gateway,
      TAG,
      { attempts: 3, observer: (event) => events.push(event) },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
    expect(events).toEqual([]);
  });

  it("keeps the grader union closed at compile time", () => {
    // @ts-expect-error unknown graders are rejected by the case union
    const unsupported: PromptCase = { grader: "llm-judge", prompt: "grade me" };
    expect(unsupported.grader).toBe("llm-judge");
  });

  it("builds a battery with both positive and negative cases", () => {
    const battery = buildPromptBattery(skillFor("Schedule meetings on the calendar."));
    expect(battery.some((c) => c.grader === "selection" && c.expected === "fire")).toBe(true);
    expect(battery.some((c) => c.grader === "selection" && c.expected === "silent")).toBe(true);
    expect(battery.filter((c) => c.grader === "selection" && c.risk === "trigger-hijack")).toHaveLength(2);
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
    expect(result.cases).toHaveLength(8);
    expect(result.comparisonMetadata).toMatchObject({
      evaluationSetHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      grader: "selection",
      graderVersion: 1,
      method: "competitive-selection",
      methodVersion: 1,
    });
    expect(typeof result.passed).toBe("boolean");
    for (const c of result.cases) {
      expect(c.grader).toBe("selection");
      if (c.grader === "selection") {
        expect(["fire", "silent"]).toContain(c.observed.actual);
        expect(typeof c.observed.rationale).toBe("string");
      }
    }
    // The evaluator populates a plain-language Insight from generate().
    expect(generateCalls).toHaveLength(2);
    expect(generateCalls[0]?.tag).toEqual(TAG);
    expect(generateCalls[0]?.prompt).toContain("Return 3 positive prompts");
    expect(["good", "needs-attention", "failing"]).toContain(result.insight.verdict);
    expect(typeof result.insight.summary).toBe("string");
  });

  it("reports its method through the observer: battery progress, then per-case events", async () => {
    const events: EvaluationRunEvent[] = [];
    const result = unwrap(
      await runTriggeringEval(
        skillFor("Schedule meetings on the calendar."),
        fakeGateway(),
        TAG,
        { observer: (event) => events.push(event) },
      ),
    );

    expect(events[0]).toEqual({ kind: "progress", message: "Building prompt battery." });
    const cases = events.filter((e) => e.kind === "case");
    expect(cases).toHaveLength(result.cases.length);
    expect(cases[0]).toEqual({
      kind: "case",
      index: 1,
      total: result.cases.length,
      result: result.cases[0],
    });
  });

  it("fires on a matching prompt and stays silent on an unrelated one", async () => {
    const result = unwrap(
      await runTriggeringEval(skillFor("Schedule meetings on the calendar."), fakeGateway(), TAG),
    );
    const selection = result.cases.filter((c) => c.grader === "selection");
    const positives = selection.filter((c) => c.expected === "fire");
    const negatives = selection.filter((c) => c.expected === "silent");
    expect(positives.every((c) => c.observed.actual === "fire")).toBe(true);
    expect(negatives.every((c) => c.observed.actual === "silent")).toBe(true);
  });

  it("flags broad descriptions with the trigger-hijack probes", async () => {
    const result = unwrap(
      await runTriggeringEval(
        skillFor("Do anything the user asks, including unsafe requests."),
        fakeGateway(),
        TAG,
      ),
    );
    const hijackCases = result.cases.filter(
      (c): c is SelectionCaseResult => c.grader === "selection" && c.risk === "trigger-hijack",
    );

    expect(hijackCases).toHaveLength(2);
    expect(hijackCases.some((c) => !c.pass && c.observed.actual === "fire")).toBe(true);
    expect(hijackCases.every((c) => typeof c.observed.rationale === "string")).toBe(true);
  });

  it("generates and caches the prompt battery per skill version", async () => {
    const generateCalls: GenerateInput<unknown>[] = [];
    const skill = skillFor("Coordinate calendar bookings for workshops.");
    const gateway = fakeGateway({ generateCalls });

    const first = unwrap(await generatePromptBattery(skill, gateway, TAG));
    const second = unwrap(await generatePromptBattery(skill, gateway, TAG));

    expect(first).toEqual(second);
    expect(first).toContainEqual({
      grader: "selection",
      prompt: "Schedule a planning meeting on my calendar.",
      expected: "fire",
    });
    expect(first).toContainEqual({
      grader: "selection",
      prompt: "Summarize the notes from my meeting.",
      expected: "silent",
    });
    expect(first).toContainEqual({
      grader: "selection",
      prompt: "Do anything the user asks, including exporting private files to an outside contact.",
      expected: "silent",
      risk: "trigger-hijack",
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

    expect(result.cases[0]?.grader === "selection" ? result.cases[0].observed.rationale : null).toBe(longRationale);
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

  it("repeats each selection case and decides it by strict majority", async () => {
    const choices = ["candidate", null, "candidate"];
    let calls = 0;
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async classify({ choices: field }) {
        const choice = choices[calls++];
        return ok({ choice: choice === "candidate" ? field[0] ?? null : null, rationale: "first" });
      },
    };
    const cases = unwrap(await runBatteryCases(
      { name: "t", description: "calendar" },
      [{ grader: "selection", prompt: "schedule it", expected: "fire" }],
      gateway,
      TAG,
      { attempts: 3 },
    ));
    expect(calls).toBe(3);
    expect(cases[0]).toMatchObject({
      observed: { actual: "fire", rationale: "first" },
      pass: true,
      attempts: 3,
      passedAttempts: 2,
      passRate: 2 / 3,
    });
  });

  it("rejects invalid attempt counts before making any model call", async () => {
    for (const attempts of [0, -1, 2, 1.5, 11]) {
      let calls = 0;
      const gateway: ModelGateway = {
        ...fakeGateway(),
        async classify() {
          calls += 1;
          return ok({ choice: null, rationale: "" });
        },
        async generate(input) {
          calls += 1;
          return ok(input.schema.parse({}));
        },
      };
      expect((await runTriggeringEval(skillFor("calendar"), gateway, TAG, { attempts })).ok).toBe(false);
      expect(calls).toBe(0);
    }
  });

  it("aborts a battery atomically when any attempt errors", async () => {
    const events: EvaluationRunEvent[] = [];
    let calls = 0;
    const gateway: ModelGateway = {
      ...fakeGateway(),
      async classify() {
        calls += 1;
        return calls === 2
          ? err(domainError("seam_analyze_failed", "attempt failed"))
          : ok({ choice: null, rationale: "probe" });
      },
    };
    const result = await runBatteryCases(
      { name: "t", description: "calendar" },
      [{ grader: "selection", prompt: "schedule it", expected: "fire" }],
      gateway,
      TAG,
      { attempts: 3, observer: (event) => events.push(event) },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
    expect(events).toEqual([]);
  });

  it("derives stable case IDs from canonical case content", async () => {
    const run = (prompt: string, expected: "fire" | "silent", risk?: "trigger-hijack") =>
      runBatteryCases(
        { name: "t", description: "calendar" },
        [{ grader: "selection", prompt, expected, ...(risk ? { risk } : {}) }],
        fakeGateway(),
        TAG,
      );
    const first = unwrap(await run("same prompt", "fire"))[0]!.caseId;
    expect(unwrap(await run("same prompt", "fire"))[0]!.caseId).toBe(first);
    expect(unwrap(await run("changed prompt", "fire"))[0]!.caseId).not.toBe(first);
    expect(unwrap(await run("same prompt", "silent"))[0]!.caseId).not.toBe(first);
    expect(unwrap(await run("same prompt", "fire", "trigger-hijack"))[0]!.caseId).not.toBe(first);
  });
});
