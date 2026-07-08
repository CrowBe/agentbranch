import type { DomainError, Result, SkillId, SkillVersionId, UserId } from "@/shared";
import type { SafetyRating } from "./safety-review.types";

/**
 * Persistence port for recorded safety ratings (ARCHITECTURE §6, §9.1).
 * `latestForVersion` answers the opt-in surface's one question — "does this
 * version already carry a rating?" — so the UI can offer the scan only for an
 * unrated version and never re-spend on a rated one.
 */
export interface SafetyRatingRepository {
  record(
    rating: Omit<SafetyRating, "id" | "createdAt">,
  ): Promise<Result<SafetyRating, DomainError>>;
  latestForVersion(
    skillId: SkillId,
    userId: UserId,
    skillVersionId: SkillVersionId,
  ): Promise<Result<SafetyRating | null, DomainError>>;
  listBySkill(
    skillId: SkillId,
    userId: UserId,
  ): Promise<Result<readonly SafetyRating[], DomainError>>;
}
