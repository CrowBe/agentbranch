import type { Result, TestRunId, UserId, SkillId, DomainError } from "@/shared";
import type { AnalysisReadFilter, TestRun, TestRunAnalysisRecord } from "./test-run.types";

/** Persistence port for recorded test runs (ARCHITECTURE §6). */
export interface TestRunRepository {
  record(run: Omit<TestRun, "id" | "createdAt">): Promise<Result<TestRun, DomainError>>;
  findById(id: TestRunId, userId: UserId): Promise<Result<TestRun | null, DomainError>>;
  listBySkill(skillId: SkillId, userId: UserId): Promise<Result<readonly TestRun[], DomainError>>;
  listByUser(userId: UserId): Promise<Result<readonly TestRun[], DomainError>>;

  /**
   * Cross-user aggregate read for the harness improvement loop (ARCHITECTURE
   * §9) — the one read on this port not scoped to a user. Returns the
   * outcomes/features projection (`TestRunAnalysisRecord`), never scenario or
   * transcript content. Every route exposing it must gate with `isAdmin` first.
   */
  listForAnalysis(
    filter?: AnalysisReadFilter,
  ): Promise<Result<readonly TestRunAnalysisRecord[], DomainError>>;
}
