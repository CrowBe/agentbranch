import type { Result, UserId, DomainError } from "@/shared";
import type { ModelTokenPrices, TokenUsageBreakdown, UsageSnapshot } from "./usage.types";

/** Persistence port for the usage meter (ARCHITECTURE §6). */
export interface UsageRepository {
  get(userId: UserId): Promise<Result<UsageSnapshot, DomainError>>;
  /** Atomically hold quota for one in-flight call; false means insufficient quota. */
  reserve(userId: UserId, costMicros: number): Promise<Result<boolean, DomainError>>;
  /** Release a reservation without recording spend (provider failure/cancellation). */
  release(userId: UserId, costMicros: number): Promise<Result<UsageSnapshot, DomainError>>;
  /** Atomically release the hold and record the turn at the resolved model's prices. */
  reconcile(
    userId: UserId,
    reservationMicros: number,
    delta: { usage: TokenUsageBreakdown; turns: number; prices: ModelTokenPrices },
  ): Promise<Result<UsageSnapshot, DomainError>>;
}
