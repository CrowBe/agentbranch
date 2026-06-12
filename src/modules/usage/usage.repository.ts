import type { Result, UserId, DomainError } from "@/shared";
import type { TokenUsageBreakdown, UsageSnapshot } from "./usage.types";

/** Persistence port for the usage meter (ARCHITECTURE §6). */
export interface UsageRepository {
  get(userId: UserId): Promise<Result<UsageSnapshot, DomainError>>;
  /** Atomically add a turn's cost and return the new snapshot. */
  increment(
    userId: UserId,
    delta: { usage: TokenUsageBreakdown; turns: number },
  ): Promise<Result<UsageSnapshot, DomainError>>;
}
