import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  SafetyRating,
  SafetyRatingRepository,
  SafetyReviewResult,
  SafetyReviewVerdict,
} from "@/modules/safety-review";
import {
  domainError,
  err,
  HarnessVersionId,
  ok,
  SafetyRatingId,
  SkillId,
  SkillVersionId,
  UserId,
} from "@/shared";

type SafetyRatingRow = {
  id: string;
  skillId: string;
  skillVersionId: string | null;
  harnessVersionId: string | null;
  userId: string;
  verdict: string;
  resultJson: unknown;
  createdAt: Date;
};

function toSafetyRating(row: SafetyRatingRow): SafetyRating {
  return {
    id: SafetyRatingId(row.id),
    skillId: SkillId(row.skillId),
    skillVersionId: row.skillVersionId ? SkillVersionId(row.skillVersionId) : null,
    harnessVersionId: row.harnessVersionId ? HarnessVersionId(row.harnessVersionId) : null,
    userId: UserId(row.userId),
    verdict: row.verdict as SafetyReviewVerdict,
    result: row.resultJson as SafetyReviewResult,
    createdAt: row.createdAt,
  };
}

/** Prisma SafetyRatingRepository (real). Persists safety ratings. */
export function createPrismaSafetyRatingRepository(prisma: PrismaClient): SafetyRatingRepository {
  return {
    async record(rating) {
      try {
        const row = await prisma.safetyRating.create({
          data: {
            skillId: rating.skillId,
            skillVersionId: rating.skillVersionId,
            harnessVersionId: rating.harnessVersionId,
            userId: rating.userId,
            verdict: rating.verdict,
            resultJson: rating.result as unknown as Prisma.InputJsonValue,
          },
        });
        return ok(toSafetyRating(row as SafetyRatingRow));
      } catch (cause) {
        return err(
          domainError("persistence_failed", "A safety rating could not be recorded.", cause),
        );
      }
    },

    async latestForVersion(skillId, userId, skillVersionId) {
      try {
        const row = await prisma.safetyRating.findFirst({
          where: { skillId, userId, skillVersionId },
          orderBy: { createdAt: "desc" },
        });
        return ok(row ? toSafetyRating(row as SafetyRatingRow) : null);
      } catch (cause) {
        return err(
          domainError("persistence_failed", "A safety rating could not be loaded.", cause),
        );
      }
    },

    async listBySkill(skillId, userId) {
      try {
        const rows = await prisma.safetyRating.findMany({
          where: { skillId, userId },
          orderBy: { createdAt: "desc" },
        });
        return ok(rows.map((row) => toSafetyRating(row as SafetyRatingRow)));
      } catch (cause) {
        return err(
          domainError("persistence_failed", "Safety ratings could not be listed.", cause),
        );
      }
    },
  };
}
