import { Prisma, type PrismaClient } from "@prisma/client";
import type { RequestRateLimiter } from "@/modules/usage";
import { ok } from "@/shared";
import { RATE_LIMIT_MESSAGE } from "@/infra/memory/rate-limit.memory-repository";

/** Prisma-backed RequestRateLimiter (real). Stores one fixed window per user/capability. */
export function createPrismaRequestRateLimiter(prisma: PrismaClient): RequestRateLimiter {
  return {
    async consume(userId, capability, policy) {
      return consumeOnce(prisma, userId, capability, policy, false);
    },
  };
}

async function consumeOnce(
  prisma: PrismaClient,
  userId: Parameters<RequestRateLimiter["consume"]>[0],
  capability: Parameters<RequestRateLimiter["consume"]>[1],
  policy: Parameters<RequestRateLimiter["consume"]>[2],
  retriedCreateRace: boolean,
): ReturnType<RequestRateLimiter["consume"]> {
  try {
    const now = new Date();
    const expiredBefore = new Date(now.getTime() - policy.windowMs);

    const consumed = await prisma.rateLimitWindow.updateMany({
      where: {
        userId,
        capability,
        windowStart: { gt: expiredBefore },
        requestCount: { lt: policy.maxRequests },
      },
      data: { requestCount: { increment: 1 } },
    });

    if (consumed.count === 1) {
      return ok({ allowed: true });
    }

    const reset = await prisma.rateLimitWindow.updateMany({
      where: {
        userId,
        capability,
        windowStart: { lte: expiredBefore },
      },
      data: { windowStart: now, requestCount: 1 },
    });

    if (reset.count === 1) {
      return ok({ allowed: true });
    }

    await prisma.rateLimitWindow.create({
      data: { userId, capability, windowStart: now, requestCount: 1 },
    });
    return ok({ allowed: true });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (!retriedCreateRace) {
        return consumeOnce(prisma, userId, capability, policy, true);
      }

      const now = new Date();
      const expiredBefore = new Date(now.getTime() - policy.windowMs);
      const current = await prisma.rateLimitWindow.findUnique({
        where: { userId_capability: { userId, capability } },
      });

      if (current && current.windowStart > expiredBefore && current.requestCount >= policy.maxRequests) {
        return ok({ allowed: false, reason: RATE_LIMIT_MESSAGE });
      }
    }

    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
