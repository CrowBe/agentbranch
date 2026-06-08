import type { RequestRateLimiter, GatedCapability } from "@/modules/usage";
import { ok, type UserId } from "@/shared";

type Clock = () => number;
type WindowState = {
  readonly windowStart: number;
  readonly count: number;
};

/** In-memory RequestRateLimiter - the offline default. */
export function createMemoryRequestRateLimiter(deps: { now?: Clock } = {}): RequestRateLimiter {
  const now = deps.now ?? Date.now;
  const windows = new Map<string, WindowState>();

  return {
    async consume(userId, capability, policy) {
      const key = keyFor(userId, capability);
      const currentTime = now();
      const current = windows.get(key);

      if (!current || currentTime - current.windowStart >= policy.windowMs) {
        windows.set(key, { windowStart: currentTime, count: 1 });
        return ok({ allowed: true });
      }

      if (current.count >= policy.maxRequests) {
        return ok({ allowed: false, reason: RATE_LIMIT_MESSAGE });
      }

      windows.set(key, { ...current, count: current.count + 1 });
      return ok({ allowed: true });
    },
  };
}

export const RATE_LIMIT_MESSAGE = "You're going a little fast - give it a few seconds and try again.";

function keyFor(userId: UserId, capability: GatedCapability): string {
  return `${userId}:${capability}`;
}
