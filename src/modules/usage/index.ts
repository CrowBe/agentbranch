/**
 * usage — the free-quota policy and the token + cost meter (ARCHITECTURE §4, §8).
 *
 * Every account gets one free quota at sign-up; spend admission is the single
 * question "is there quota left". The meter prices each turn at record time
 * (micro-USD) and is the same counter reused for paid metering later. Policy
 * is pure and lives here; persistence is a port.
 */
export type {
  GatedCapability,
  TokenUsageBreakdown,
  ModelTokenPrices,
  UsageSnapshot,
  CapDecision,
  RateLimitPolicy,
} from "./usage.types";
export {
  INITIAL_QUOTA_MICROS,
  TOKEN_PRICES_MICROS,
  QUOTA_EXHAUSTED_MESSAGE,
  REQUEST_RATE_LIMIT,
  costOfTurn,
  pricesForModel,
  maximumTurnCost,
  quotaRemainingMicros,
  formatQuotaMicros,
  checkQuota,
  applyTurn,
} from "./meter";
export type { UsageRepository } from "./usage.repository";
export type { RequestRateLimiter } from "./rate-limit.repository";
