import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { costOfTurn, INITIAL_QUOTA_MICROS } from "@/modules/usage";
import { ok, type UserId } from "@/shared";

/** In-memory UsageRepository — the offline default. */
export function createMemoryUsageRepository(): UsageRepository {
  const snapshots = new Map<string, UsageSnapshot>();

  const read = (userId: UserId): UsageSnapshot =>
    snapshots.get(userId) ?? {
      userId,
      tokensUsed: 0,
      turnsUsed: 0,
      costMicrosUsed: 0,
      costMicrosReserved: 0,
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      cacheReadInputTokensUsed: 0,
      cacheCreationInputTokensUsed: 0,
    };

  return {
    async get(userId) {
      return ok(read(userId));
    },
    async reserve(userId, costMicros) {
      const current = read(userId);
      if (current.costMicrosUsed + current.costMicrosReserved + costMicros > INITIAL_QUOTA_MICROS) return ok(false);
      snapshots.set(userId, { ...current, costMicrosReserved: current.costMicrosReserved + costMicros });
      return ok(true);
    },
    async release(userId, costMicros) {
      const current = read(userId);
      const next = { ...current, costMicrosReserved: Math.max(0, current.costMicrosReserved - costMicros) };
      snapshots.set(userId, next);
      return ok(next);
    },
    async reconcile(userId, reservationMicros, delta) {
      const current = read(userId);
      const tokens = delta.usage.inputTokens + delta.usage.outputTokens + delta.usage.cacheReadInputTokens + delta.usage.cacheCreationInputTokens;
      const next: UsageSnapshot = {
        ...current,
        tokensUsed: current.tokensUsed + tokens,
        turnsUsed: current.turnsUsed + delta.turns,
        costMicrosUsed: current.costMicrosUsed + costOfTurn(delta.usage, delta.prices),
        costMicrosReserved: Math.max(0, current.costMicrosReserved - reservationMicros),
        inputTokensUsed: current.inputTokensUsed + delta.usage.inputTokens,
        outputTokensUsed: current.outputTokensUsed + delta.usage.outputTokens,
        cacheReadInputTokensUsed: current.cacheReadInputTokensUsed + delta.usage.cacheReadInputTokens,
        cacheCreationInputTokensUsed: current.cacheCreationInputTokensUsed + delta.usage.cacheCreationInputTokens,
      };
      snapshots.set(userId, next);
      return ok(next);
    },
  };
}
