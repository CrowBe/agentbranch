import type { Result, TestRunId, UserId, SkillId, DomainError } from "@/shared";
import type { TestRun } from "./test-run.types";

/** Persistence port for recorded test runs (ARCHITECTURE §6). */
export interface TestRunRepository {
  record(run: Omit<TestRun, "id" | "createdAt">): Promise<Result<TestRun, DomainError>>;
  findById(id: TestRunId, userId: UserId): Promise<Result<TestRun | null, DomainError>>;
  listBySkill(skillId: SkillId, userId: UserId): Promise<Result<readonly TestRun[], DomainError>>;
  listByUser(userId: UserId): Promise<Result<readonly TestRun[], DomainError>>;
}
