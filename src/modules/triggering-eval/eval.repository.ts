import type { Result, EvalRunId, SkillId, UserId, DomainError } from "@/shared";
import type { AnalysisReadFilter, EvalRun, EvalRunAnalysisRecord } from "./triggering-eval.types";

/** Persistence port for recorded triggering-eval runs (ARCHITECTURE §6). */
export interface EvalRunRepository {
  record(run: Omit<EvalRun, "id" | "createdAt">): Promise<Result<EvalRun, DomainError>>;
  findById(id: EvalRunId, userId: UserId): Promise<Result<EvalRun | null, DomainError>>;
  listBySkill(skillId: SkillId, userId: UserId): Promise<Result<readonly EvalRun[], DomainError>>;
  listByUser(userId: UserId): Promise<Result<readonly EvalRun[], DomainError>>;

  /**
   * Cross-user aggregate read for the harness improvement loop (ARCHITECTURE
   * §9) — the one read on this port not scoped to a user. Returns the
   * outcomes/features projection (`EvalRunAnalysisRecord`), never raw prompts
   * or skill content. Every route exposing it must gate with `isAdmin` first.
   */
  listForAnalysis(
    filter?: AnalysisReadFilter,
  ): Promise<Result<readonly EvalRunAnalysisRecord[], DomainError>>;
}
