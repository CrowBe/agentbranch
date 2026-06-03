import { describe, it, expect } from "vitest";
import { executeSkill, defaultMockToolRegistry } from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { ModelGateway, AgentStep } from "@/modules/model-gateway";
import { ok, unwrap, SkillId, UserId } from "@/shared";

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

/**
 * A fake gateway whose `runAgent` drives the loop the way the real one does:
 * it invokes each supplied tool handler once and records the calls/results into
 * a transcript. This exercises the evaluator's *method* (mocks-as-handlers,
 * nothing real touched) without a model.
 */
function fakeGateway(): ModelGateway {
  return {
    hasModel: true,
    async classify() {
      return ok({ choice: null, rationale: "n/a" });
    },
    async streamAgent() {
      // The build loop's primitive; unused by the test-run evaluator.
      async function* empty() {}
      return ok(empty());
    },
    async runAgent({ messages, tools }) {
      const transcript: AgentStep[] = [
        { kind: "model", text: `Reading: ${messages[0]?.content ?? ""}` },
      ];
      for (const t of tools) {
        const output = await t.handler({});
        transcript.push({ kind: "tool-call", tool: t.name, input: {} });
        transcript.push({ kind: "tool-result", tool: t.name, output });
      }
      transcript.push({ kind: "model", text: "Done. Nothing real was touched." });
      return ok({ transcript });
    },
    async generate({ schema }) {
      // Validate a canned insight through the caller's schema so the generic
      // return type is honoured — same contract the real adapter satisfies.
      return ok(
        schema.parse({
          verdict: "good",
          summary: "The skill read the inbox and drafted a sensible reply.",
          findings: ["called the email tool"],
          watch: [],
        }),
      );
    },
  };
}

const TAG = { kind: "account" as const, userId: UserId("u1"), capability: "test-run" as const };

describe("test run", () => {
  it("produces a test-run artifact whose transcript calls each mock tool", async () => {
    const result = unwrap(
      await executeSkill({
        skill: fixtureSkill(),
        gateway: fakeGateway(),
        tag: TAG,
        registry: defaultMockToolRegistry(),
      }),
    );
    expect(result.kind).toBe("test-run");
    expect(
      result.transcript.some((s) => s.kind === "tool-call" && s.tool === "read_email"),
    ).toBe(true);
    expect(result.transcript.some((s) => s.kind === "tool-result")).toBe(true);
  });

  it("builds its own world when no scenario/registry is supplied", async () => {
    const result = unwrap(
      await executeSkill({ skill: fixtureSkill(), gateway: fakeGateway(), tag: TAG }),
    );
    expect(result.kind).toBe("test-run");
    // The evaluator's default scenario mentions the skill by name.
    expect(result.scenario.prompt).toContain("skill");
    // Default registry is the email mock, so its call shows up.
    expect(
      result.transcript.some((s) => s.kind === "tool-call" && s.tool === "read_email"),
    ).toBe(true);
  });
});
