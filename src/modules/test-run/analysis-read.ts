import type { SkillVersionLintSummary } from "@/modules/skill";
import type { TestRun, TestRunAnalysisRecord, TestRunToolUse } from "./test-run.types";

/** Aggregate reads are bounded: this caps `limit` (and is the default). */
export const ANALYSIS_READ_LIMIT = 500;

export function analysisReadLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return ANALYSIS_READ_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), ANALYSIS_READ_LIMIT));
}

/**
 * Project a stored test run onto the analysis read model — the one place the
 * outcomes/features governance is enforced (ARCHITECTURE §9): user identity,
 * scenario content, and tool payloads never cross into the aggregate read.
 * Shared by both adapters so the projection can't drift between them.
 */
export function toTestRunAnalysisRecord(
  run: TestRun,
  skillLintSummary: SkillVersionLintSummary | null,
): TestRunAnalysisRecord {
  const calls = new Map<string, number>();
  let modelSteps = 0;
  for (const step of run.transcript) {
    if (step.kind === "model") modelSteps += 1;
    if (step.kind === "tool-call") calls.set(step.tool, (calls.get(step.tool) ?? 0) + 1);
  }
  const toolUse: TestRunToolUse[] = [...calls.entries()]
    .map(([tool, count]) => ({ tool, calls: count }))
    .sort((a, b) => a.tool.localeCompare(b.tool));

  return {
    id: run.id,
    skillId: run.skillId,
    skillVersionId: run.skillVersionId,
    harnessVersionId: run.harnessVersionId,
    status: run.status,
    toolUse,
    modelSteps,
    skillLintSummary,
    createdAt: run.createdAt,
  };
}
