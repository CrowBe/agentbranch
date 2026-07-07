import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountingTag, ModelGateway } from "@/modules/model-gateway";
import { baselineSkillCorpus } from "@/modules/baseline-corpus";
import { createMemoryBenchmarkRunRepository } from "@/infra/memory/benchmark.memory-repository";
import { HarnessVersionId, isErr, unwrap } from "@/shared";
import {
  regressionBenchmarkSet,
  regressionBenchmarkSetHash,
  runRegressionBenchmark,
} from "./index";
import { ok } from "@/shared";

/** A gateway that answers classify from the corpus's own expectations —
 * a perfect harness, so the frozen set scores 1. */
function perfectGateway(observed: { tags: AccountingTag[]; choiceFields: string[][] }): ModelGateway {
  return {
    hasModel: true,
    async classify({ prompt, choices, tag }) {
      observed.tags.push(tag);
      observed.choiceFields.push([...choices]);
      const candidate = choices[0] ?? "";
      const name = candidate.split(":")[0] ?? "";
      const entry = baselineSkillCorpus.find((e) => e.name === name);
      const fires = entry?.promptBattery.some((c) => c.prompt === prompt && c.expected === "fire");
      return ok({ choice: fires ? candidate : null, rationale: "corpus oracle" });
    },
    async streamAgent() {
      async function* empty() {}
      return ok(empty());
    },
    async runAgent() {
      return ok({ transcript: [] });
    },
    async generate(input) {
      return ok(input.schema.parse({}));
    },
  };
}

describe("regression benchmark", () => {
  it("freezes the baseline corpus as the set, with a stable content-derived hash", () => {
    expect(regressionBenchmarkSet).toHaveLength(baselineSkillCorpus.length);
    expect(regressionBenchmarkSetHash).toMatch(/^[0-9a-f]{64}$/);
    for (const entry of regressionBenchmarkSet) {
      expect(entry.battery.length).toBeGreaterThan(0);
      expect(entry.battery.some((c) => c.expected === "fire")).toBe(true);
      expect(entry.battery.some((c) => c.expected === "silent")).toBe(true);
    }
  });

  it("scores every corpus battery through classify, platform-tagged, candidate excluded from the field", async () => {
    const observed: { tags: AccountingTag[]; choiceFields: string[][] } = {
      tags: [],
      choiceFields: [],
    };
    const score = unwrap(await runRegressionBenchmark(perfectGateway(observed)));

    expect(score.benchmarkSetHash).toBe(regressionBenchmarkSetHash);
    expect(score.totalCases).toBe(
      regressionBenchmarkSet.reduce((sum, entry) => sum + entry.battery.length, 0),
    );
    expect(score.passedCases).toBe(score.totalCases);
    expect(score.score).toBe(1);
    expect(score.perSkill).toHaveLength(regressionBenchmarkSet.length);

    // Measuring our own harness is platform spend, never a user's.
    expect(observed.tags.every((tag) => tag.kind === "platform")).toBe(true);
    // The corpus skills are the distractor library — each candidate competes
    // against the field minus itself, never a duplicate of itself.
    for (const choices of observed.choiceFields) {
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it("fails model_unavailable offline, like every evaluation surface", async () => {
    const offline = { ...perfectGateway({ tags: [], choiceFields: [] }), hasModel: false };
    const result = await runRegressionBenchmark(offline);
    expect(isErr(result) && result.error.tag === "model_unavailable").toBe(true);
  });

  it("records runs pinned to a harness version and lists them newest first", async () => {
    vi.useFakeTimers();
    const repo = createMemoryBenchmarkRunRepository();
    const score = {
      benchmarkSetHash: regressionBenchmarkSetHash,
      totalCases: 60,
      passedCases: 54,
      score: 0.9,
      perSkill: [],
    };
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const first = unwrap(await repo.record({ harnessVersionId: HarnessVersionId("h1"), ...score }));
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z"));
    const second = unwrap(
      await repo.record({ harnessVersionId: HarnessVersionId("h2"), ...score, passedCases: 57 }),
    );

    const listed = unwrap(await repo.list());
    expect(listed.map((run) => run.id)).toEqual([second.id, first.id]);
    expect(listed.every((run) => run.benchmarkSetHash === regressionBenchmarkSetHash)).toBe(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
