import type {
  UsageSnapshot,
  CapDecision,
  RateLimitPolicy,
  TokenUsageBreakdown,
} from "./usage.types";

/**
 * The free quota: every account's one-time model-spend budget, granted at
 * sign-up (ARCHITECTURE §8). One number in micro-USD — denominated in money,
 * not tokens, because the balance is user-visible (price transparency). Spend
 * admission asks a single question, is there quota left, irrespective of
 * capability; structural bounds (skill-count cap, request rate limit, byte
 * budget) and the provider cap-catch bound burst and abuse separately.
 */
export const INITIAL_QUOTA_MICROS = 1_000_000; // $1.00

/**
 * Token prices in micro-USD per token — numerically equal to USD per million
 * tokens. One conservative Sonnet-class table across routed models in v1;
 * per-model tables slot in here when the router carries materially different
 * price points.
 */
export const TOKEN_PRICES_MICROS = {
  inputPerToken: 3,
  outputPerToken: 15,
  cacheReadPerToken: 0.3,
  cacheCreationPerToken: 3.75,
} as const;

/** A turn's cost in micro-USD, rounded up so fractional turns still spend. */
export function costOfTurn(usage: TokenUsageBreakdown): number {
  return Math.ceil(
    usage.inputTokens * TOKEN_PRICES_MICROS.inputPerToken +
      usage.outputTokens * TOKEN_PRICES_MICROS.outputPerToken +
      usage.cacheReadInputTokens * TOKEN_PRICES_MICROS.cacheReadPerToken +
      usage.cacheCreationInputTokens * TOKEN_PRICES_MICROS.cacheCreationPerToken,
  );
}

/** What's left of the free quota, floored at zero for display. */
export function quotaRemainingMicros(snapshot: UsageSnapshot): number {
  return Math.max(0, INITIAL_QUOTA_MICROS - snapshot.costMicrosUsed);
}

/** Micro-USD as user-facing dollars, e.g. `$0.87`. */
export function formatQuotaMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export const QUOTA_EXHAUSTED_MESSAGE = "You've used all of your free quota.";

/** Burst guard: per-user, per-capability requests admitted each minute. */
export const REQUEST_RATE_LIMIT: RateLimitPolicy = {
  maxRequests: 12,
  windowMs: 60_000,
};

/** May this user spend right now? One question: is there quota left. */
export function checkQuota(snapshot: UsageSnapshot): CapDecision {
  if (snapshot.costMicrosUsed >= INITIAL_QUOTA_MICROS) {
    return { allowed: false, reason: QUOTA_EXHAUSTED_MESSAGE };
  }
  return { allowed: true };
}

/** Fold a turn's token cost into a snapshot (pure). */
export function applyTurn(snapshot: UsageSnapshot, usage: TokenUsageBreakdown): UsageSnapshot {
  const tokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens;
  return {
    ...snapshot,
    tokensUsed: snapshot.tokensUsed + tokens,
    turnsUsed: snapshot.turnsUsed + 1,
    costMicrosUsed: snapshot.costMicrosUsed + costOfTurn(usage),
    inputTokensUsed: snapshot.inputTokensUsed + usage.inputTokens,
    outputTokensUsed: snapshot.outputTokensUsed + usage.outputTokens,
    cacheReadInputTokensUsed: snapshot.cacheReadInputTokensUsed + usage.cacheReadInputTokens,
    cacheCreationInputTokensUsed:
      snapshot.cacheCreationInputTokensUsed + usage.cacheCreationInputTokens,
  };
}
