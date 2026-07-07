import { describe, it, expect } from "vitest";
import {
  computeContractChecks,
  executeSkill,
  defaultMockToolRegistry,
  testRunCapability,
} from "./index";
import { makeSkill, parseSkillMd, type Skill } from "@/modules/skill";
import type { ModelGateway, AgentStep, GenerateInput } from "@/modules/model-gateway";
import { parseResponseSchema } from "@/modules/response-schema";
import { parseToolContract } from "@/modules/tool-contract";
import { ok, unwrap, SkillId, UserId } from "@/shared";

function fixtureSkill(id = "s1"): Skill {
  const source = unwrap(parseSkillMd(`---\nname: t\ndescription: d\n---\nbody`));
  return makeSkill({
    id: SkillId(id),
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
function fakeGateway(calls: { generate: GenerateInput<unknown>[] } = { generate: [] }): ModelGateway {
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
    async generate(input) {
      calls.generate.push(input);
      if (input.system.includes("deterministic test-run inputs")) {
        return ok(
          input.schema.parse({
            scenario: {
              prompt: "Summarise the recent customer tickets and identify the riskiest one.",
              seedData: { customer: "Acme" },
            },
            mockTools: [
              {
                name: "search_tickets",
                description: "Returns mocked customer support tickets.",
                response: {
                  tickets: [
                    {
                      id: "T-100",
                      subject: "Production deploy blocked",
                      priority: "high",
                    },
                  ],
                },
              },
            ],
          }),
        );
      }

      // Validate a canned insight through the caller's schema so the generic
      // return type is honoured — same contract the real adapter satisfies.
      return ok(
        input.schema.parse({
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
        scenario: { prompt: "Check the inbox.", seedData: {} },
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
    const calls: { generate: GenerateInput<unknown>[] } = { generate: [] };
    const result = unwrap(
      await executeSkill({ skill: fixtureSkill(), gateway: fakeGateway(calls), tag: TAG }),
    );
    expect(result.kind).toBe("test-run");
    expect(result.scenario.prompt).toContain("customer tickets");
    // The evaluator infers a matching mock from the generated world.
    expect(
      result.transcript.some((s) => s.kind === "tool-call" && s.tool === "search_tickets"),
    ).toBe(true);
    expect(calls.generate[0]?.tag).toEqual({
      kind: "platform",
      reason: "test-run mock world generation",
    });
  });

  it("reuses the generated world for deterministic reruns of the same skill version", async () => {
    const skill = fixtureSkill("s2");
    const calls: { generate: GenerateInput<unknown>[] } = { generate: [] };
    const gateway = fakeGateway(calls);

    unwrap(await executeSkill({ skill, gateway, tag: TAG }));
    unwrap(await executeSkill({ skill, gateway, tag: TAG }));

    const worldGenerations = calls.generate.filter((call) =>
      call.system.includes("deterministic test-run inputs"),
    );
    expect(worldGenerations).toHaveLength(1);
  });

  it("clamps transcript content before sending it into insight generation", async () => {
    const calls: { generate: GenerateInput<unknown>[] } = { generate: [] };
    const longText = "transcript ".repeat(200);
    const gateway: ModelGateway = {
      ...fakeGateway(calls),
      async runAgent() {
        return ok({
          transcript: [
            { kind: "model", text: longText },
            { kind: "tool-result", tool: "search", output: { value: longText } },
          ],
        });
      },
    };

    unwrap(
      await executeSkill({
        skill: fixtureSkill("s3"),
        gateway,
        tag: TAG,
        scenario: { prompt: longText, seedData: {} },
        registry: defaultMockToolRegistry(),
      }),
    );

    const insightPrompt = calls.generate.at(-1)?.prompt ?? "";
    expect(insightPrompt).not.toContain(longText);
    expect(insightPrompt).toContain(longText.slice(0, 120));
  });
});

const INVOICE_SCHEMA_RAW = JSON.stringify({
  title: "invoice-summary",
  description: "Summary of one invoice.",
  type: "object",
  required: ["invoiceId"],
  properties: { invoiceId: { type: "string", description: "The invoice id." } },
});

const REMINDER_CONTRACT_RAW = JSON.stringify({
  name: "send_invoice_reminder",
  description: "Send a payment reminder for one overdue invoice.",
  input: {
    type: "object",
    required: ["invoiceId"],
    properties: { invoiceId: { type: "string", description: "The invoice to remind about." } },
  },
  output: { $ref: "invoice-summary" },
});

describe("relational test run (Skill × Tool contract bundle)", () => {
  const bundle = {
    toolContracts: [unwrap(parseToolContract(REMINDER_CONTRACT_RAW))],
    responseSchemas: [unwrap(parseResponseSchema(INVOICE_SCHEMA_RAW))],
  };

  it("drives the mock-tool registry from the contract and validates each call", async () => {
    const calls: { generate: GenerateInput<unknown>[] } = { generate: [] };
    const result = unwrap(
      await executeSkill({
        skill: fixtureSkill("s-bundle"),
        gateway: fakeGateway(calls),
        tag: TAG,
        scenario: { prompt: "Chase the overdue invoice.", seedData: {} },
        ...bundle,
      }),
    );

    // The registry came from the contract, not the inferred world.
    expect(
      result.transcript.some((s) => s.kind === "tool-call" && s.tool === "send_invoice_reminder"),
    ).toBe(true);

    // The fake gateway calls tools with `{}` — missing the required argument.
    const check = result.contractChecks.find((c) => c.tool === "send_invoice_reminder");
    expect(check?.called).toBe(true);
    expect(check?.calls[0]?.argumentIssues[0]).toContain("missing required property `invoiceId`");
    // The mock output was generated from the referenced response schema.
    expect(check?.calls[0]?.outputIssues).toEqual([]);

    // The deterministic checks reach the insight prompt.
    const insightPrompt = calls.generate.at(-1)?.prompt ?? "";
    expect(insightPrompt).toContain("Tool-contract checks");

    // …and the Insights renderer surfaces them in `watch` regardless of the model.
    const insights = testRunCapability.renderers.insights.render(result);
    expect(insights.watch.join("\n")).toContain("did not match the contract's input schema");
  });

  it("reports a contract whose tool the skill never called", () => {
    const checks = computeContractChecks([], bundle.toolContracts, bundle.responseSchemas);
    expect(checks).toEqual([
      { tool: "send_invoice_reminder", called: false, calls: [] },
    ]);
  });

  it("stays a plain single-primitive run without contracts", async () => {
    const result = unwrap(
      await executeSkill({
        skill: fixtureSkill("s-plain"),
        gateway: fakeGateway(),
        tag: TAG,
        scenario: { prompt: "Check the inbox.", seedData: {} },
        registry: defaultMockToolRegistry(),
      }),
    );
    expect(result.contractChecks).toEqual([]);
    expect(testRunCapability.renderers.insights.render(result)).toEqual(result.insight);
  });
});
