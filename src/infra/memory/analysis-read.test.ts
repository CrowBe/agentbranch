import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryEvalRunRepository } from "./eval.memory-repository";
import { createMemoryTestRunRepository } from "./test-run.memory-repository";
import type { EvalRun } from "@/modules/triggering-eval";
import type { TestRun } from "@/modules/test-run";
import type { SkillVersionLintSummary } from "@/modules/skill";
import { HarnessVersionId, SkillId, SkillVersionId, UserId, unwrap } from "@/shared";

const LINT_SUMMARY: SkillVersionLintSummary = {
  score: 88,
  grade: "B",
  counts: { error: 0, warn: 1, info: 0 },
  rules: ["body.negative-scope.missing"],
};

function evalRunFor(
  userId: string,
  passed: boolean,
  versionId: string | null = null,
): Omit<EvalRun, "id" | "createdAt"> {
  return {
    userId: UserId(userId),
    skillId: SkillId("s1"),
    skillVersionId: versionId ? SkillVersionId(versionId) : null,
    harnessVersionId: HarnessVersionId("h1"),
    status: passed ? "passed" : "failed",
    result: {
      kind: "triggering-eval",
      cases: [
        {
          prompt: "the secret user prompt",
          expected: "fire",
          actual: passed ? "fire" : "silent",
          pass: passed,
          rationale: "matched the calendar keyword",
        },
      ],
      passed,
      insight: { verdict: "good", summary: "fine", findings: [], watch: [] },
    },
  };
}

function testRunFor(userId: string): Omit<TestRun, "id" | "createdAt"> {
  return {
    userId: UserId(userId),
    skillId: SkillId("s1"),
    skillVersionId: SkillVersionId("v1"),
    harnessVersionId: HarnessVersionId("h1"),
    status: "completed",
    scenario: { prompt: "the secret scenario", seedData: { customer: "Acme" } },
    transcript: [
      { kind: "model", text: "thinking" },
      { kind: "tool-call", tool: "email_search", input: { q: "private" } },
      { kind: "tool-result", tool: "email_search", output: { hits: 3 } },
      { kind: "tool-call", tool: "email_search", input: { q: "again" } },
      { kind: "model", text: "done" },
    ],
  };
}

describe("aggregate analysis reads (memory adapters)", () => {
  it("reads across users and strips identity and prompt content", async () => {
    const repo = createMemoryEvalRunRepository();
    await repo.record(evalRunFor("u1", true));
    await repo.record(evalRunFor("u2", false));

    const records = unwrap(await repo.listForAnalysis());
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).not.toHaveProperty("userId");
      expect(record).not.toHaveProperty("result");
      for (const c of record.cases) {
        expect(c).not.toHaveProperty("prompt");
        expect(c.rationale).toBe("matched the calendar keyword");
      }
    }
    expect(records.map((r) => r.passed).sort()).toEqual([false, true]);
  });

  it("joins the skill version's lint summary when a resolver is wired", async () => {
    const repo = createMemoryEvalRunRepository({
      resolveLintSummary: (versionId) => (versionId === "v1" ? LINT_SUMMARY : null),
    });
    await repo.record(evalRunFor("u1", true, "v1"));
    await repo.record(evalRunFor("u1", true, "v2"));
    await repo.record(evalRunFor("u1", true, null));

    const records = unwrap(await repo.listForAnalysis());
    const summaries = records.map((r) => r.skillLintSummary);
    expect(summaries.filter((s) => s !== null)).toEqual([LINT_SUMMARY]);
  });

  it("applies since and caps limit", async () => {
    vi.useFakeTimers();
    const repo = createMemoryEvalRunRepository();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    await repo.record(evalRunFor("u1", true));
    vi.setSystemTime(new Date("2026-07-03T00:00:00Z"));
    await repo.record(evalRunFor("u2", false));

    const cutoff = new Date("2026-07-02T00:00:00Z");
    expect(unwrap(await repo.listForAnalysis({ since: cutoff }))).toHaveLength(1);
    expect(unwrap(await repo.listForAnalysis({ limit: 1 }))).toHaveLength(1);
    expect(unwrap(await repo.listForAnalysis({ limit: 10_000 }))).toHaveLength(2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reduces test-run transcripts to tool-use shape, never payloads", async () => {
    const repo = createMemoryTestRunRepository({
      resolveLintSummary: () => LINT_SUMMARY,
    });
    await repo.record(testRunFor("u1"));
    await repo.record(testRunFor("u2"));

    const records = unwrap(await repo.listForAnalysis());
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record).not.toHaveProperty("userId");
      expect(record).not.toHaveProperty("scenario");
      expect(record).not.toHaveProperty("transcript");
      expect(record.toolUse).toEqual([{ tool: "email_search", calls: 2 }]);
      expect(record.modelSteps).toBe(2);
      expect(record.skillLintSummary).toEqual(LINT_SUMMARY);
    }
  });
});
