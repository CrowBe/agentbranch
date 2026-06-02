import type { EvalRun, EvalRunRepository } from "@/modules/triggering-eval";
import { ok, EvalRunId, type SkillId } from "@/shared";

/** In-memory EvalRunRepository — the offline default. */
export function createMemoryEvalRunRepository(): EvalRunRepository {
  const runs = new Map<string, EvalRun>();

  return {
    async record(run) {
      const full: EvalRun = { ...run, id: EvalRunId(crypto.randomUUID()), createdAt: new Date() };
      runs.set(full.id, full);
      return ok(full);
    },
    async findById(id) {
      return ok(runs.get(id) ?? null);
    },
    async listBySkill(skillId: SkillId) {
      return ok([...runs.values()].filter((r) => r.skillId === skillId));
    },
  };
}
