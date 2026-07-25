import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountingTag, ModelGateway } from "@/modules/model-gateway";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { createMemoryBenchmarkRunRepository } from "@/infra/memory/benchmark.memory-repository";
import { HarnessVersionId, isErr, unwrap, wilson95 } from "@/shared";
import {
  regressionBenchmarkSet,
  regressionBenchmarkSetHash,
  responseSchemaBenchmarkSet,
  responseSchemaBenchmarkSetHash,
  safetyBenchmarkSet,
  safetyBenchmarkSetHash,
  toolContractBenchmarkSet,
  toolContractBenchmarkSetHash,
  canonicalBenchmarkCase,
  runRegressionBenchmark,
  runTaskOutcomeBenchmarkDimension,
} from "./index";
import { taskOutcomeCorpus, taskOutcomeCorpusSetHash } from "@/modules/task-outcome-corpus";
import { ok } from "@/shared";

/** A gateway that answers classify from the corpus's own expectations —
 * a perfect harness, so the frozen set scores 1. */
function perfectGateway(observed: {
  tags: AccountingTag[];
  choiceFields: string[][];
}): ModelGateway {
  return {
    hasModel: true,
    async classify({ prompt, choices, tag }) {
      observed.tags.push(tag);
      observed.choiceFields.push([...choices]);
      const candidate = choices[0] ?? "";
      const name = candidate.split(":")[0] ?? "";
      const entry = baselineSkillCorpus.find((e) => e.name === name);
      const fires = entry?.promptBattery.some(
        (c) => c.prompt === prompt && c.expected === "fire",
      );
      return ok({
        choice: fires ? candidate : null,
        rationale: "corpus oracle",
      });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async generate(input) {
      const output = input.prompt.includes("Acme owes")
        ? { customer: "Acme", currency: "AUD", totalOutstanding: 2450, overdueInvoices: 2, priority: "high" }
        : input.prompt.includes("Jamie requests")
          ? { customerName: "Jamie", requestedWindow: "Tuesday afternoon", action: "offer-slot", needsConfirmation: true }
          : input.prompt.includes("FILTER-20")
            ? { sku: "FILTER-20", reorderQuantity: 12, action: "reorder", rationale: "Stock cover is shorter than lead time." }
            : { currency: "AUD", inflows: 8100, outflows: 5725, netCashFlow: 2375 };
      return ok(input.schema.parse(output));
    },
  };
}

describe("regression benchmark", () => {
  it("freezes the baseline corpus as the set, with a stable content-derived hash", () => {
    expect({
      regressionBenchmarkSetHash,
      responseSchemaBenchmarkSetHash,
      toolContractBenchmarkSetHash,
      safetyBenchmarkSetHash,
    }).toEqual({
      regressionBenchmarkSetHash: "bdf6cdc99a346f5811232f2b33b4cc84beae647875b419e057488bfd46517cbb",
      responseSchemaBenchmarkSetHash: "c835434bbf0a7fd5c042070c460563fa244ef502e946d67c8bd2d6ad00d4fbbc",
      toolContractBenchmarkSetHash: "3731c7e923ff738503bbfafdb2dcc679d3bb1fb740ea66d456447119b5ee9312",
      safetyBenchmarkSetHash: "f342701b2fd1b9ba830159299556feb9a8d9f89a0fadec442d30008ba05e412e",
    });
    expect(regressionBenchmarkSet).toHaveLength(baselineSkillCorpus.length);
    expect(regressionBenchmarkSetHash).toMatch(/^[0-9a-f]{64}$/);
    for (const entry of regressionBenchmarkSet) {
      expect(entry.battery.length).toBeGreaterThan(0);
      expect(entry.battery.some((c) => c.grader === "selection" && c.expected === "fire")).toBe(true);
      expect(entry.battery.some((c) => c.grader === "selection" && c.expected === "silent")).toBe(true);
    }
  });

  it("keeps selection bytes legacy-exact and canonicalizes versioned JSON graders", () => {
    expect(canonicalBenchmarkCase({
      grader: "selection",
      prompt: "schedule it",
      expected: "fire",
    })).toBe("fire|schedule it");
    const left = canonicalBenchmarkCase({
      grader: "json-output",
      graderVersion: 1,
      prompt: "return a count",
      expectedSchema: { required: ["count"], properties: { count: { type: "number" } }, type: "object" },
    });
    const right = canonicalBenchmarkCase({
      grader: "json-output",
      graderVersion: 1,
      prompt: "return a count",
      expectedSchema: { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
    });
    expect(left).toBe(right);
    expect(left).toContain('"benchmark-case",1,"json-output",1');
    expect(canonicalBenchmarkCase({
      grader: "json-output",
      graderVersion: 1,
      prompt: "unicode keys",
      expectedSchema: { ä: 4, z: 2, Å: 3, a: 1 },
    })).toContain('{"a":1,"z":2,"Å":3,"ä":4}');
  });

  it("scores every corpus battery through classify, platform-tagged, candidate excluded from the field", async () => {
    const observed: { tags: AccountingTag[]; choiceFields: string[][] } = {
      tags: [],
      choiceFields: [],
    };
    const score = unwrap(
      await runRegressionBenchmark(perfectGateway(observed)),
    );

    expect(score.benchmarkSetHash).toBe(regressionBenchmarkSetHash);
    expect(score.totalCases).toBe(
      regressionBenchmarkSet.reduce(
        (sum, entry) => sum + entry.battery.length,
        0,
      ),
    );
    expect(score.passedCases).toBe(score.totalCases);
    expect(score.attempts).toBe(1);
    expect(score.totalAttempts).toBe(score.totalCases);
    expect(score.passedAttempts).toBe(score.passedCases);
    expect(score.attemptPassRateInterval).toMatchObject({
      method: "wilson",
      version: 1,
      confidence: 0.95,
      numerator: score.passedAttempts,
      denominator: score.totalAttempts,
      rate: score.passedAttempts / score.totalAttempts,
    });
    expect(score.score).toBe(1);
    expect(score.perSkill).toHaveLength(regressionBenchmarkSet.length);
    expect(score.dimensions.responseSchema).toMatchObject({
      benchmarkSetHash: responseSchemaBenchmarkSetHash,
      totalCases: responseSchemaBenchmarkSet.length,
      passedCases: responseSchemaBenchmarkSet.length,
      score: 1,
    });
    expect(score.dimensions.responseSchema).not.toHaveProperty("interval");
    expect(score.dimensions.toolContract).not.toHaveProperty("interval");
    expect(score.dimensions.safety).not.toHaveProperty("interval");
    expect(score.dimensions.toolContract).toMatchObject({
      benchmarkSetHash: toolContractBenchmarkSetHash,
      totalCases: toolContractBenchmarkSet.length,
      passedCases: toolContractBenchmarkSet.length,
      score: 1,
    });
    expect(score.dimensions.safety).toMatchObject({
      benchmarkSetHash: safetyBenchmarkSetHash,
      totalCases: safetyBenchmarkSet.length,
    });
    expect(score.dimensions.taskOutcome).toMatchObject({
      benchmarkSetHash: taskOutcomeCorpusSetHash,
      totalCases: taskOutcomeCorpus.length,
      passedCases: taskOutcomeCorpus.length,
      score: 1,
      method: {
        kind: "model",
        grader: "json-output",
        graderVersion: 1,
        method: "generate-then-schema-validate",
        methodVersion: 1,
        attemptsPerCase: 1,
      },
    });
    expect(score.dimensions.taskOutcome).toMatchObject({
      attempts: 1,
      totalAttempts: taskOutcomeCorpus.length,
      passedAttempts: taskOutcomeCorpus.length,
      attemptPassRate: 1,
      attemptPassRateInterval: {
        method: "wilson",
        version: 1,
        numerator: taskOutcomeCorpus.length,
        denominator: taskOutcomeCorpus.length,
      },
    });

    // Measuring our own harness is platform spend, never a user's.
    expect(observed.tags.every((tag) => tag.kind === "platform")).toBe(true);
    // The corpus skills are the distractor library — each candidate competes
    // against the field minus itself, never a duplicate of itself.
    for (const choices of observed.choiceFields) {
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it("fails model_unavailable offline, like every evaluation surface", async () => {
    const offline = {
      ...perfectGateway({ tags: [], choiceFields: [] }),
      hasModel: false,
    };
    const result = await runRegressionBenchmark(offline);
    expect(isErr(result) && result.error.tag === "model_unavailable").toBe(
      true,
    );
  });

  it("fails the independently runnable model-bearing dimension honestly offline", async () => {
    const result = await runTaskOutcomeBenchmarkDimension({
      ...perfectGateway({ tags: [], choiceFields: [] }),
      hasModel: false,
    });
    expect(isErr(result) && result.error.tag === "model_unavailable").toBe(true);
  });

  it("rejects structurally valid but wrong outcomes for every frozen workflow", async () => {
    const gateway = perfectGateway({ tags: [], choiceFields: [] });
    const wrong = {
      ...gateway,
      async generate({ prompt }: Parameters<ModelGateway["generate"]>[0]) {
        return ok(prompt.includes("Acme owes")
          ? { customer: "Acme", currency: "AUD", totalOutstanding: 2450, overdueInvoices: 2, priority: "normal" }
          : prompt.includes("Jamie requests")
            ? { customerName: "Jamie", requestedWindow: "Tuesday afternoon", action: "ask-clarification", needsConfirmation: true }
            : prompt.includes("FILTER-20")
              ? { sku: "FILTER-20", reorderQuantity: 6, action: "reorder", rationale: "Stock cover is shorter than lead time." }
              : { currency: "AUD", inflows: 8100, outflows: 5725, netCashFlow: 13825 });
      },
    } as ModelGateway;
    const dimension = unwrap(await runTaskOutcomeBenchmarkDimension(wrong));
    expect(dimension.entries).toHaveLength(4);
    expect(dimension.entries.every((entry) => !entry.passed)).toBe(true);
    expect(dimension.passedAttempts).toBe(0);
  });

  it("repeats triggering cases without changing case totals", async () => {
    const observed: { tags: AccountingTag[]; choiceFields: string[][] } = {
      tags: [],
      choiceFields: [],
    };
    const score = unwrap(await runRegressionBenchmark(perfectGateway(observed), { attempts: 3 }));

    expect(score.attempts).toBe(3);
    expect(score.totalAttempts).toBe(score.totalCases * 3);
    expect(score.passedAttempts).toBe(score.totalAttempts);
    expect(observed.tags).toHaveLength(score.totalAttempts);
    expect(score.perSkill.every((skill) => skill.totalAttempts === skill.totalCases * 3)).toBe(true);
    expect(score.dimensions.taskOutcome).toMatchObject({
      attempts: 3,
      totalAttempts: taskOutcomeCorpus.length * 3,
      passedAttempts: taskOutcomeCorpus.length * 3,
      attemptPassRate: 1,
      method: { attemptsPerCase: 3 },
    });
  });

  it("rejects invalid attempts before model availability and observer effects", async () => {
    const observed = { tags: [] as AccountingTag[], choiceFields: [] as string[][] };
    const observer = vi.fn();
    const gateway = { ...perfectGateway(observed), hasModel: false };

    const result = await runRegressionBenchmark(gateway, { attempts: 2, observer });

    expect(isErr(result) && result.error.tag).toBe("invalid_operation");
    expect(observer).not.toHaveBeenCalled();
    expect(observed.tags).toEqual([]);
  });

  it("records runs pinned to a harness version and lists them newest first", async () => {
    vi.useFakeTimers();
    const repo = createMemoryBenchmarkRunRepository();
    const score = {
      benchmarkSetHash: regressionBenchmarkSetHash,
      totalCases: 60,
      passedCases: 54,
      attempts: 1,
      totalAttempts: 60,
      passedAttempts: 54,
      attemptPassRateInterval: wilson95(54, 60),
      score: 0.9,
      perSkill: [],
      dimensions: {
        responseSchema: emptyDimension(responseSchemaBenchmarkSetHash),
        toolContract: emptyDimension(toolContractBenchmarkSetHash),
        safety: emptyDimension(safetyBenchmarkSetHash),
        taskOutcome: {
          ...emptyDimension(taskOutcomeCorpusSetHash),
          attempts: 1,
          totalAttempts: 1,
          passedAttempts: 0,
          attemptPassRate: 0,
          attemptPassRateInterval: wilson95(0, 1),
          method: {
            kind: "model" as const,
            grader: "json-output" as const,
            graderVersion: 1 as const,
            method: "generate-then-schema-validate" as const,
            methodVersion: 1 as const,
            attemptsPerCase: 1,
          },
        },
      },
    };
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const first = unwrap(
      await repo.record({ harnessVersionId: HarnessVersionId("h1"), ...score }),
    );
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z"));
    const second = unwrap(
      await repo.record({
        harnessVersionId: HarnessVersionId("h2"),
        ...score,
        passedCases: 57,
      }),
    );

    const listed = unwrap(await repo.list());
    expect(listed.map((run) => run.id)).toEqual([second.id, first.id]);
    expect(
      listed.every(
        (run) => run.benchmarkSetHash === regressionBenchmarkSetHash,
      ),
    ).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

function emptyDimension(benchmarkSetHash: string) {
  return {
    benchmarkSetHash,
    totalCases: 0,
    passedCases: 0,
    score: 0,
    entries: [],
  };
}
