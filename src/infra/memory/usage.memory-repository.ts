import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { ok, type UserId } from "@/shared";

/** In-memory UsageRepository — the offline default. */
export function createMemoryUsageRepository(): UsageRepository {
  const snapshots = new Map<string, UsageSnapshot>();

  const read = (userId: UserId): UsageSnapshot =>
    snapshots.get(userId) ?? { userId, tokensUsed: 0, turnsUsed: 0 };

  return {
    async get(userId) {
      return ok(read(userId));
    },
    async increment(userId, delta) {
      const current = read(userId);
      const next: UsageSnapshot = {
        userId,
        tokensUsed: current.tokensUsed + delta.tokens,
        turnsUsed: current.turnsUsed + delta.turns,
      };
      snapshots.set(userId, next);
      return ok(next);
    },
  };
}
