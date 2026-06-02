import type { PrismaClient } from "@prisma/client";
import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { ok, UserId } from "@/shared";

/** Prisma UsageRepository (real). Upserts the per-user counter row. */
export function createPrismaUsageRepository(prisma: PrismaClient): UsageRepository {
  const toSnapshot = (row: { userId: string; tokensUsed: number; turnsUsed: number }): UsageSnapshot => ({
    userId: UserId(row.userId),
    tokensUsed: row.tokensUsed,
    turnsUsed: row.turnsUsed,
  });

  return {
    async get(userId) {
      const row = await prisma.usage.findUnique({ where: { userId } });
      return ok(row ? toSnapshot(row) : { userId, tokensUsed: 0, turnsUsed: 0 });
    },

    async increment(userId, delta) {
      const row = await prisma.usage.upsert({
        where: { userId },
        create: { userId, tokensUsed: delta.tokens, turnsUsed: delta.turns },
        update: {
          tokensUsed: { increment: delta.tokens },
          turnsUsed: { increment: delta.turns },
        },
      });
      return ok(toSnapshot(row));
    },
  };
}
