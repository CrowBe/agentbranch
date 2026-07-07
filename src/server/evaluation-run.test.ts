import { describe, it, expect } from "vitest";
import {
  evaluationResponse,
  runRecordedEvaluation,
  resolvePinnedVersionId,
  wantsSse,
  type EvaluationRunDeps,
} from "./evaluation-run";
import { createMemorySkillRepository } from "@/infra/memory/skill.memory-repository";
import { createMemoryTestRunRepository } from "@/infra/memory/test-run.memory-repository";
import { createMemoryEvalRunRepository } from "@/infra/memory/eval.memory-repository";
import { createMemoryHarnessVersionRepository } from "@/infra/memory/harness-version.memory-repository";
import { currentHarnessManifest } from "@/modules/harness-version";
import { makeSkill, parseSkillMd, type Skill, type SkillSource } from "@/modules/skill";
import type { ModelGateway } from "@/modules/model-gateway";
import type { TestRunBreakdown } from "@/modules/test-run";
import { parseToolContract } from "@/modules/tool-contract";
import type { TriggeringResult } from "@/modules/triggering-eval";
import {
  domainError,
  err,
  isErr,
  ok,
  readSseEvents,
  unwrap,
  SkillId,
  UserId,
  type EvaluationEvent,
} from "@/shared";

const userId = UserId("user-1");

function sourceOf(body: string): SkillSource {
  return unwrap(
    parseSkillMd(`---\nname: greeter\ndescription: Schedule meetings on the calendar.\n---\n${body}`),
  );
}

function skillOf(source: SkillSource, id = "s1"): Skill {
  return makeSkill({
    id: SkillId(id),
    userId,
    source,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

/**
 * A deterministic fake gateway good enough for both evaluators' methods: canned
 * battery + insight through `generate`, keyword-match `classify`, a `runAgent`
 * that drives the supplied tool handlers once (the mock-tool registry).
 */
function fakeGateway(hasModel = true): ModelGateway {
  return {
    hasModel,
    async classify({ prompt, choices }) {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      const candidate = choices[0] ?? "";
      const words = new Set(candidate.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4));
      const fires = prompt.toLowerCase().split(/[^a-z]+/).some((w) => words.has(w));
      return ok({ choice: fires ? candidate : null, rationale: "probe" });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async runAgent({ tools }) {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      const transcript = [];
      for (const t of tools) {
        const output = await t.handler({});
        transcript.push({ kind: "tool-call" as const, tool: t.name, input: {} });
        transcript.push({ kind: "tool-result" as const, tool: t.name, output });
      }
      return ok({ transcript });
    },
    async generate(input) {
      if (!hasModel) return err(domainError("model_unavailable", "offline"));
      if (input.prompt.includes("Return 3 positive prompts and 3 negative prompts.")) {
        return ok(
          input.schema.parse({
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
          }),
        );
      }
      if (input.system.includes("deterministic test-run inputs")) {
        return ok(
          input.schema.parse({
            scenario: { prompt: "Check my calendar.", seedData: {} },
            mockTools: [
              {
                name: "read_calendar",
                description: "Returns mocked calendar entries.",
                response: { entries: [] },
              },
            ],
          }),
        );
      }
      return ok(
        input.schema.parse({
          verdict: "good",
          summary: "Looks right.",
          findings: [],
          watch: [],
        }),
      );
    },
  };
}

function makeDeps(gateway: ModelGateway = fakeGateway()) {
  const skills = createMemorySkillRepository();
  const testRuns = createMemoryTestRunRepository();
  const evalRuns = createMemoryEvalRunRepository();
  const harnessVersions = createMemoryHarnessVersionRepository();
  const deps: EvaluationRunDeps = {
    gateway,
    skills,
    testRuns,
    evalRuns,
    currentHarnessVersion: () => harnessVersions.current(currentHarnessManifest()),
  };
  return { deps, skills, testRuns, evalRuns };
}

const noPin = { skillId: null, branchId: null };

describe("runRecordedEvaluation — the choreography, once, against memory adapters", () => {
  it("runs a test run through the seam and records the run with a harness stamp", async () => {
    const { deps, testRuns } = makeDeps();
    const skill = skillOf(sourceOf("Say hello."));

    const outcome = unwrap(await runRecordedEvaluation("test-run", "insights", skill, noPin, deps));
    expect(outcome.body).toMatchObject({ verdict: "good" });

    const recorded = unwrap(await testRuns.listBySkill(skill.id, userId));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.status).toBe("completed");
    expect(recorded[0]?.harnessVersionId).toBeTruthy();
    expect(recorded[0]?.skillVersionId).toBeNull(); // unsaved skill → null pin
  });

  it("threads a bundle's equipment into the test run and surfaces contract checks", async () => {
    const { deps, testRuns } = makeDeps();
    const skill = skillOf(sourceOf("Chase the overdue invoice."));
    const equipment = {
      toolContracts: [
        unwrap(
          parseToolContract(
            JSON.stringify({
              name: "send_invoice_reminder",
              description: "Send a payment reminder for one overdue invoice.",
              input: {
                type: "object",
                required: ["invoiceId"],
                properties: { invoiceId: { type: "string", description: "The invoice id." } },
              },
            }),
          ),
        ),
      ],
    };

    const outcome = unwrap(
      await runRecordedEvaluation(
        "test-run",
        "breakdown",
        skill,
        noPin,
        deps,
        undefined,
        equipment,
      ),
    );

    const body = outcome.body as TestRunBreakdown;
    expect(body.contractChecks[0]?.tool).toBe("send_invoice_reminder");
    expect(body.contractChecks[0]?.called).toBe(true);
    // The fake gateway calls with `{}`, so the argument validation must fire.
    expect(body.contractChecks[0]?.calls[0]?.argumentIssues[0]).toContain("invoiceId");
    // The contract, not the inferred world, provided the mock tool.
    expect(
      body.transcript.some((s) => s.kind === "tool-call" && s.tool === "send_invoice_reminder"),
    ).toBe(true);

    const recorded = unwrap(await testRuns.listBySkill(skill.id, userId));
    expect(recorded).toHaveLength(1);
  });

  it("runs a triggering eval and records pass/fail from the artifact", async () => {
    const { deps, evalRuns } = makeDeps();
    const skill = skillOf(sourceOf("Say hello."));

    const outcome = unwrap(
      await runRecordedEvaluation("triggering-eval", "breakdown", skill, noPin, deps),
    );
    const artifact = outcome.artifact as TriggeringResult;

    const recorded = unwrap(await evalRuns.listBySkill(skill.id, userId));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.status).toBe(artifact.passed ? "passed" : "failed");
    expect(recorded[0]?.result).toEqual(artifact);
  });

  it("reports progress and per-case events through the observer, recording last", async () => {
    const { deps } = makeDeps();
    const skill = skillOf(sourceOf("Say hello."));
    const events: { kind: string; message?: string }[] = [];

    unwrap(
      await runRecordedEvaluation("triggering-eval", "insights", skill, noPin, deps, (e) =>
        events.push(e),
      ),
    );

    expect(events[0]).toEqual({ kind: "progress", message: "Building prompt battery." });
    expect(events.some((e) => e.kind === "case")).toBe(true);
    expect(events.at(-1)).toEqual({ kind: "progress", message: "Recording triggering eval." });
  });

  it("fails without recording when the evaluation fails", async () => {
    const { deps, evalRuns } = makeDeps(fakeGateway(false));
    // hasModel true so the run starts, but every primitive fails:
    const gateway = { ...deps.gateway, hasModel: true } as ModelGateway;
    const skill = skillOf(sourceOf("Say hello."));

    const outcome = await runRecordedEvaluation(
      "triggering-eval",
      "insights",
      skill,
      noPin,
      { ...deps, gateway },
    );

    expect(isErr(outcome)).toBe(true);
    expect(unwrap(await evalRuns.listByUser(userId))).toHaveLength(0);
  });
});

describe("resolvePinnedVersionId", () => {
  it("pins a draft evaluation to the draft head, not the main version", async () => {
    const { skills } = makeDeps();
    const source = sourceOf("Say hello.");
    const created = unwrap(await skills.create({ userId, source }));
    const branch = unwrap(await skills.createBranch({ id: created.id, userId }));
    const edited = sourceOf("Say hello warmly.");
    const draftHead = unwrap(
      await skills.saveToBranch({ id: created.id, userId, branchId: branch.id, source: edited }),
    );

    const pinned = unwrap(
      await resolvePinnedVersionId(skills, skillOf(edited, created.id), {
        skillId: created.id,
        branchId: branch.id,
      }),
    );

    expect(pinned).toBe(draftHead.id);
    expect(pinned).not.toBe(created.latestVersionId);
  });

  it("pins to the main version when no draft is named", async () => {
    const { skills } = makeDeps();
    const source = sourceOf("Say hello.");
    const created = unwrap(await skills.create({ userId, source }));

    const pinned = unwrap(
      await resolvePinnedVersionId(skills, skillOf(source, created.id), {
        skillId: created.id,
        branchId: null,
      }),
    );

    expect(pinned).toBe(created.latestVersionId);
  });

  it("records with a null pin when the evaluated source drifts from the draft head", async () => {
    const { skills } = makeDeps();
    const source = sourceOf("Say hello.");
    const created = unwrap(await skills.create({ userId, source }));
    const branch = unwrap(await skills.createBranch({ id: created.id, userId }));
    const drifted = sourceOf("Unsaved edit.");

    const pinned = unwrap(
      await resolvePinnedVersionId(skills, skillOf(drifted, created.id), {
        skillId: created.id,
        branchId: branch.id,
      }),
    );

    expect(pinned).toBeNull();
  });
});

describe("evaluationResponse — HTTP shaping", () => {
  it("answers 503 offline before any stream opens", async () => {
    const { deps } = makeDeps(fakeGateway(false));
    const response = await evaluationResponse({
      kind: "test-run",
      surface: "insights",
      sse: true,
      skill: skillOf(sourceOf("Say hello.")),
      pin: noPin,
      deps,
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("model_unavailable");
  });

  it("returns the rendered surface as JSON when SSE is not requested", async () => {
    const { deps } = makeDeps();
    const response = await evaluationResponse({
      kind: "test-run",
      surface: "insights",
      sse: false,
      skill: skillOf(sourceOf("Say hello.")),
      pin: noPin,
      deps,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verdict: "good" });
  });

  it("streams progress → cases → artifact over SSE", async () => {
    const { deps } = makeDeps();
    const response = await evaluationResponse({
      kind: "triggering-eval",
      surface: "insights",
      sse: true,
      skill: skillOf(sourceOf("Say hello.")),
      pin: noPin,
      deps,
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events: EvaluationEvent[] = [];
    for await (const event of readSseEvents<EvaluationEvent>(response.body!)) {
      events.push(event);
    }

    expect(events[0]).toEqual({
      event: "eval-progress",
      data: { message: "Building prompt battery." },
    });
    expect(events.some((e) => e.event === "eval-case")).toBe(true);
    const last = events.at(-1);
    expect(last?.event).toBe("artifact");
    if (last?.event === "artifact") {
      expect(last.data.surface).toBe("insights");
      expect(last.data.body).toMatchObject({ verdict: "good" });
      expect(last.data.result).toMatchObject({ kind: "triggering-eval" });
    }
  });
});

describe("wantsSse", () => {
  it("reads the accept header", () => {
    expect(wantsSse(new Request("http://x", { headers: { accept: "text/event-stream" } }))).toBe(true);
    expect(wantsSse(new Request("http://x"))).toBe(false);
  });
});
