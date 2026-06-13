import type { Result, SkillId, UserId, DomainError } from "@/shared";
import type { Skill, SkillSource } from "./skill.types";

/**
 * Persistence port for skills. The domain owns this interface; infra supplies
 * implementations (Prisma, in-memory). Append-only versioning lives behind
 * `save` — each save records a new revision (see ARCHITECTURE §6).
 */
export interface SkillRepository {
  create(input: {
    userId: UserId;
    source: SkillSource;
  }): Promise<Result<Skill, DomainError>>;

  save(input: {
    id: SkillId;
    userId: UserId;
    source: SkillSource;
  }): Promise<Result<Skill, DomainError>>;

  findById(id: SkillId, userId: UserId): Promise<Result<Skill | null, DomainError>>;

  listByUser(userId: UserId): Promise<Result<readonly Skill[], DomainError>>;

  delete(id: SkillId, userId: UserId): Promise<Result<void, DomainError>>;
}
