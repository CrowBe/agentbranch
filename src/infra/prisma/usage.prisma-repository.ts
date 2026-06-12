import type { PrismaClient } from "@prisma/client";
import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { ok, UserId } from "@/shared";

/** Prisma UsageRepository (real). Upserts the per-user counter row. */
export function createPrismaUsageRepository(prisma: PrismaClient): UsageRepository {
  const toSnapshot = (row: {
    userId: string;
    tokensUsed: number;
    turnsUsed: number;
    inputTokensUsed: number;
    outputTokensUsed: number;
    cacheReadInputTokensUsed: number;
    cacheCreationInputTokensUsed: number;
  }): UsageSnapshot => ({
    userId: UserId(row.userId),
    tokensUsed: row.tokensUsed,
    turnsUsed: row.turnsUsed,
    inputTokensUsed: row.inputTokensUsed,
    outputTokensUsed: row.outputTokensUsed,
    cacheReadInputTokensUsed: row.cacheReadInputTokensUsed,
    cacheCreationInputTokensUsed: row.cacheCreationInputTokensUsed,
  });

  const zeroSnapshot = (userId: Parameters<UsageRepository["get"]>[0]): UsageSnapshot => ({
    userId,
    tokensUsed: 0,
    turnsUsed: 0,
    inputTokensUsed: 0,
    outputTokensUsed: 0,
    cacheReadInputTokensUsed: 0,
    cacheCreationInputTokensUsed: 0,
  });

  return {
    async get(userId) {
      const row = await prisma.usage.findUnique({ where: { userId } });
      return ok(row ? toSnapshot(row) : zeroSnapshot(userId));
    },

    async increment(userId, delta) {
      const tokens =
        delta.usage.inputTokens +
        delta.usage.outputTokens +
        delta.usage.cacheReadInputTokens +
        delta.usage.cacheCreationInputTokens;
      const row = await prisma.usage.upsert({
        where: { userId },
        create: {
          userId,
          tokensUsed: tokens,
          turnsUsed: delta.turns,
          inputTokensUsed: delta.usage.inputTokens,
          outputTokensUsed: delta.usage.outputTokens,
          cacheReadInputTokensUsed: delta.usage.cacheReadInputTokens,
          cacheCreationInputTokensUsed: delta.usage.cacheCreationInputTokens,
        },
        update: {
          tokensUsed: { increment: tokens },
          turnsUsed: { increment: delta.turns },
          inputTokensUsed: { increment: delta.usage.inputTokens },
          outputTokensUsed: { increment: delta.usage.outputTokens },
          cacheReadInputTokensUsed: { increment: delta.usage.cacheReadInputTokens },
          cacheCreationInputTokensUsed: { increment: delta.usage.cacheCreationInputTokens },
        },
      });
      return ok(toSnapshot(row));
    },
  };
}
