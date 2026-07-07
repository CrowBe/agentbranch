import type { TestRun, TestRunRepository } from "@/modules/test-run";
import { analysisReadLimit, toTestRunAnalysisRecord } from "@/modules/test-run";
import type { SkillVersionLintSummary } from "@/modules/skill";
import { ok, TestRunId, type SkillId, type UserId } from "@/shared";

export type MemoryTestRunOptions = {
  /** Joins the skill version's lint summary into the analysis read model —
   * wired from the shared memory skill store; absent means no join (null). */
  readonly resolveLintSummary?: (versionId: string) => SkillVersionLintSummary | null;
};

/** In-memory TestRunRepository — the offline default. */
export function createMemoryTestRunRepository(
  options: MemoryTestRunOptions = {},
): TestRunRepository {
  const runs = new Map<string, TestRun>();

  return {
    async record(run) {
      const full: TestRun = { ...run, id: TestRunId(crypto.randomUUID()), createdAt: new Date() };
      runs.set(full.id, full);
      return ok(full);
    },
    async findById(id, userId) {
      const run = runs.get(id);
      return ok(run?.userId === userId ? run : null);
    },
    async listBySkill(skillId: SkillId, userId: UserId) {
      return ok([...runs.values()].filter((r) => r.skillId === skillId && r.userId === userId));
    },
    async listByUser(userId: UserId) {
      return ok([...runs.values()].filter((r) => r.userId === userId));
    },
    async listForAnalysis(filter = {}) {
      const records = [...runs.values()]
        .filter((r) => (filter.since ? r.createdAt >= filter.since : true))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, analysisReadLimit(filter.limit))
        .map((r) =>
          toTestRunAnalysisRecord(
            r,
            r.skillVersionId ? (options.resolveLintSummary?.(r.skillVersionId) ?? null) : null,
          ),
        );
      return ok(records);
    },
  };
}
