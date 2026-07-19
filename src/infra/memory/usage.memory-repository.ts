import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { costOfTurn } from "@/modules/usage";
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
      inputTokensUsed: 0,
      outputTokensUsed: 0,
      cacheReadInputTokensUsed: 0,
      cacheCreationInputTokensUsed: 0,
    };

  return {
    async get(userId) {
      return ok(read(userId));
    },
    async increment(userId, delta) {
      const current = read(userId);
      const tokens =
        delta.usage.inputTokens +
        delta.usage.outputTokens +
        delta.usage.cacheReadInputTokens +
        delta.usage.cacheCreationInputTokens;
      const next: UsageSnapshot = {
        userId,
        tokensUsed: current.tokensUsed + tokens,
        turnsUsed: current.turnsUsed + delta.turns,
        costMicrosUsed: current.costMicrosUsed + costOfTurn(delta.usage),
        inputTokensUsed: current.inputTokensUsed + delta.usage.inputTokens,
        outputTokensUsed: current.outputTokensUsed + delta.usage.outputTokens,
        cacheReadInputTokensUsed:
          current.cacheReadInputTokensUsed + delta.usage.cacheReadInputTokens,
        cacheCreationInputTokensUsed:
          current.cacheCreationInputTokensUsed + delta.usage.cacheCreationInputTokens,
      };
      snapshots.set(userId, next);
      return ok(next);
    },
  };
}
