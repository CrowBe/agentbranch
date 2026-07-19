import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { UsageRepository, UsageSnapshot } from "@/modules/usage";
import { costOfTurn, INITIAL_QUOTA_MICROS } from "@/modules/usage";
import { ok, UserId } from "@/shared";

/** Prisma UsageRepository (real). Upserts the per-user counter row. */
export function createPrismaUsageRepository(prisma: PrismaClient): UsageRepository {
  const toSnapshot = (row: {
    userId: string;
    tokensUsed: number;
    turnsUsed: number;
    costMicrosUsed: number;
    costMicrosReserved: number;
    inputTokensUsed: number;
    outputTokensUsed: number;
    cacheReadInputTokensUsed: number;
    cacheCreationInputTokensUsed: number;
  }): UsageSnapshot => ({
    userId: UserId(row.userId),
    tokensUsed: row.tokensUsed,
    turnsUsed: row.turnsUsed,
    costMicrosUsed: row.costMicrosUsed,
    costMicrosReserved: row.costMicrosReserved,
    inputTokensUsed: row.inputTokensUsed,
    outputTokensUsed: row.outputTokensUsed,
    cacheReadInputTokensUsed: row.cacheReadInputTokensUsed,
    cacheCreationInputTokensUsed: row.cacheCreationInputTokensUsed,
  });

  const zeroSnapshot = (userId: Parameters<UsageRepository["get"]>[0]): UsageSnapshot => ({
    userId,
    tokensUsed: 0,
    turnsUsed: 0,
    costMicrosUsed: 0,
    costMicrosReserved: 0,
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

    async reserve(userId, costMicros) {
      if (costMicros > INITIAL_QUOTA_MICROS) return ok(false);
      // Atomic conditional increment cannot be expressed by Prisma's update API.
      // eslint-disable-next-line no-restricted-syntax
      const rows = await prisma.$queryRaw<readonly { reserved: boolean }[]>`
        INSERT INTO "usage" ("user_id", "cost_micros_reserved", "updated_at")
        VALUES (${userId}, ${costMicros}, NOW())
        ON CONFLICT ("user_id") DO UPDATE
        SET "cost_micros_reserved" = "usage"."cost_micros_reserved" + ${costMicros},
            "updated_at" = NOW()
        WHERE "usage"."cost_micros_used" + "usage"."cost_micros_reserved" + ${costMicros} <= ${INITIAL_QUOTA_MICROS}
        RETURNING TRUE AS "reserved"
      `;
      return ok(rows.length === 1);
    },

    async release(userId, costMicros) {
      // GREATEST prevents a duplicated cleanup from making reservations negative.
      // eslint-disable-next-line no-restricted-syntax
      await prisma.$executeRaw`
        UPDATE "usage"
        SET "cost_micros_reserved" = GREATEST(0, "cost_micros_reserved" - ${costMicros}),
            "updated_at" = NOW()
        WHERE "user_id" = ${userId}
      `;
      const row = await prisma.usage.findUnique({ where: { userId } });
      return ok(row ? toSnapshot(row) : zeroSnapshot(userId));
    },

    async reconcile(userId, reservationMicros, delta) {
      const tokens = delta.usage.inputTokens + delta.usage.outputTokens + delta.usage.cacheReadInputTokens + delta.usage.cacheCreationInputTokens;
      const costMicros = costOfTurn(delta.usage, delta.prices);
      await prisma.$transaction(async (tx) => {
        // The counter update and append-only charge must commit as one accounting write.
        // eslint-disable-next-line no-restricted-syntax
        await tx.$executeRaw`
          UPDATE "usage"
          SET "tokens_used" = "tokens_used" + ${tokens},
              "turns_used" = "turns_used" + ${delta.turns},
              "cost_micros_used" = "cost_micros_used" + ${costMicros},
              "cost_micros_reserved" = GREATEST(0, "cost_micros_reserved" - ${reservationMicros}),
              "input_tokens_used" = "input_tokens_used" + ${delta.usage.inputTokens},
              "output_tokens_used" = "output_tokens_used" + ${delta.usage.outputTokens},
              "cache_read_input_tokens_used" = "cache_read_input_tokens_used" + ${delta.usage.cacheReadInputTokens},
              "cache_creation_input_tokens_used" = "cache_creation_input_tokens_used" + ${delta.usage.cacheCreationInputTokens},
              "updated_at" = NOW()
          WHERE "user_id" = ${userId}
        `;
        await tx.usageCharge.create({
          data: {
            id: randomUUID(), userId, priceKey: delta.prices.key, costMicros,
            inputTokens: delta.usage.inputTokens,
            outputTokens: delta.usage.outputTokens,
            cacheReadInputTokens: delta.usage.cacheReadInputTokens,
            cacheCreationInputTokens: delta.usage.cacheCreationInputTokens,
          },
        });
      });
      const row = await prisma.usage.findUniqueOrThrow({ where: { userId } });
      return ok(toSnapshot(row));
    },

    async increment(userId, delta) {
      const tokens =
        delta.usage.inputTokens +
        delta.usage.outputTokens +
        delta.usage.cacheReadInputTokens +
        delta.usage.cacheCreationInputTokens;
      const costMicros = costOfTurn(delta.usage);
      const row = await prisma.usage.upsert({
        where: { userId },
        create: {
          userId,
          tokensUsed: tokens,
          turnsUsed: delta.turns,
          costMicrosUsed: costMicros,
          costMicrosReserved: 0,
          inputTokensUsed: delta.usage.inputTokens,
          outputTokensUsed: delta.usage.outputTokens,
          cacheReadInputTokensUsed: delta.usage.cacheReadInputTokens,
          cacheCreationInputTokensUsed: delta.usage.cacheCreationInputTokens,
        },
        update: {
          tokensUsed: { increment: tokens },
          turnsUsed: { increment: delta.turns },
          costMicrosUsed: { increment: costMicros },
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
