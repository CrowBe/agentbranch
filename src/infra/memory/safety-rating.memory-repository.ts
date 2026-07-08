import type { SafetyRating, SafetyRatingRepository } from "@/modules/safety-review";
import { ok, SafetyRatingId } from "@/shared";

/** In-memory SafetyRatingRepository — the offline default. */
export function createMemorySafetyRatingRepository(): SafetyRatingRepository {
  const ratings = new Map<string, SafetyRating>();

  return {
    async record(rating) {
      const full: SafetyRating = {
        ...rating,
        id: SafetyRatingId(crypto.randomUUID()),
        createdAt: new Date(),
      };
      ratings.set(full.id, full);
      return ok(full);
    },
    async latestForVersion(skillId, userId, skillVersionId) {
      const latest = [...ratings.values()]
        .filter(
          (r) =>
            r.skillId === skillId &&
            r.userId === userId &&
            r.skillVersionId === skillVersionId,
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return ok(latest ?? null);
    },
    async listBySkill(skillId, userId) {
      return ok(
        [...ratings.values()].filter((r) => r.skillId === skillId && r.userId === userId),
      );
    },
  };
}
