import type { Result, EvalRunId, SkillId, UserId, DomainError } from "@/shared";
import type { EvalRun } from "./triggering-eval.types";

/** Persistence port for recorded triggering-eval runs (ARCHITECTURE §6). */
export interface EvalRunRepository {
  record(run: Omit<EvalRun, "id" | "createdAt">): Promise<Result<EvalRun, DomainError>>;
  findById(id: EvalRunId, userId: UserId): Promise<Result<EvalRun | null, DomainError>>;
  listBySkill(skillId: SkillId, userId: UserId): Promise<Result<readonly EvalRun[], DomainError>>;
  listByUser(userId: UserId): Promise<Result<readonly EvalRun[], DomainError>>;
}
