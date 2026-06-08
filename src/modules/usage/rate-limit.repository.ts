import type { DomainError, Result, UserId } from "@/shared";
import type { CapDecision, GatedCapability, RateLimitPolicy } from "./usage.types";

/** Persistence port for per-user request rate limits. */
export interface RequestRateLimiter {
  consume(
    userId: UserId,
    capability: GatedCapability,
    policy: RateLimitPolicy,
  ): Promise<Result<CapDecision, DomainError>>;
}
