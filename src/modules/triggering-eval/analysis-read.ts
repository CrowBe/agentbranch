import type { SkillVersionLintSummary } from "@/modules/skill";
import type { EvalRun, EvalRunAnalysisRecord } from "./triggering-eval.types";

/** Aggregate reads are bounded: this caps `limit` (and is the default). */
export const ANALYSIS_READ_LIMIT = 500;

export function analysisReadLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return ANALYSIS_READ_LIMIT;
  return Math.max(1, Math.min(Math.floor(limit), ANALYSIS_READ_LIMIT));
}

/**
 * Project a stored eval run onto the analysis read model — the one place the
 * outcomes/features governance is enforced (ARCHITECTURE §9): user identity and
 * prompt text never cross into the aggregate read. Shared by both adapters so
 * the projection can't drift between them.
 */
export function toEvalRunAnalysisRecord(
  run: EvalRun,
  skillLintSummary: SkillVersionLintSummary | null,
): EvalRunAnalysisRecord {
  return {
    id: run.id,
    skillId: run.skillId,
    skillVersionId: run.skillVersionId,
    harnessVersionId: run.harnessVersionId,
    status: run.status,
    passed: run.result.passed,
    cases: run.result.cases.map((c) => ({
      expected: c.expected,
      actual: c.actual,
      pass: c.pass,
      rationale: c.rationale,
      ...(c.risk === undefined ? {} : { risk: c.risk }),
    })),
    skillLintSummary,
    createdAt: run.createdAt,
  };
}
