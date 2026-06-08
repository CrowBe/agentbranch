import type { PrismaClient } from "@prisma/client";
import type { RequestRateLimiter } from "@/modules/usage";
import { ok } from "@/shared";
import { RATE_LIMIT_MESSAGE } from "@/infra/memory/rate-limit.memory-repository";

/** Prisma-backed RequestRateLimiter (real). Stores one fixed window per user/capability. */
export function createPrismaRequestRateLimiter(prisma: PrismaClient): RequestRateLimiter {
  return {
    async consume(userId, capability, policy) {
      const now = new Date();
      const expiredBefore = new Date(now.getTime() - policy.windowMs);
      const where = { userId_capability: { userId, capability } };
      const current = await prisma.rateLimitWindow.findUnique({ where });

      if (!current) {
        await prisma.rateLimitWindow.create({
          data: { userId, capability, windowStart: now, requestCount: 1 },
        });
        return ok({ allowed: true });
      }

      if (current.windowStart <= expiredBefore) {
        await prisma.rateLimitWindow.update({
          where,
          data: { windowStart: now, requestCount: 1 },
        });
        return ok({ allowed: true });
      }

      if (current.requestCount >= policy.maxRequests) {
        return ok({ allowed: false, reason: RATE_LIMIT_MESSAGE });
      }

      await prisma.rateLimitWindow.update({
        where,
        data: { requestCount: { increment: 1 } },
      });
      return ok({ allowed: true });
    },
  };
}
