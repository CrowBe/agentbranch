import type { TestRun, TestRunRepository } from "@/modules/test-run";
import { ok, TestRunId, type SkillId, type UserId } from "@/shared";

/** In-memory TestRunRepository — the offline default. */
export function createMemoryTestRunRepository(): TestRunRepository {
  const runs = new Map<string, TestRun>();

  return {
    async record(run) {
      const full: TestRun = { ...run, id: TestRunId(crypto.randomUUID()), createdAt: new Date() };
      runs.set(full.id, full);
      return ok(full);
    },
    async findById(id) {
      return ok(runs.get(id) ?? null);
    },
    async listBySkill(skillId: SkillId) {
      return ok([...runs.values()].filter((r) => r.skillId === skillId));
    },
    async listByUser(userId: UserId) {
      return ok([...runs.values()].filter((r) => r.userId === userId));
    },
  };
}
