import type {
  UsageSnapshot,
  CapDecision,
  RateLimitPolicy,
  TokenUsageBreakdown,
  ModelTokenPrices,
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
export const TOKEN_PRICES_MICROS: ModelTokenPrices = {
  key: "anthropic:sonnet",
  inputPerToken: 3,
  outputPerToken: 15,
  cacheReadPerToken: 0.3,
  cacheCreationPerToken: 3.75,
} as const;

const MODEL_PRICE_TABLE: readonly { readonly matches: RegExp; readonly prices: ModelTokenPrices }[] = [
  { matches: /claude-haiku/i, prices: { key: "anthropic:haiku", inputPerToken: 1, outputPerToken: 5, cacheReadPerToken: 0.1, cacheCreationPerToken: 1.25 } },
  { matches: /claude-sonnet/i, prices: TOKEN_PRICES_MICROS },
  { matches: /claude-opus/i, prices: { key: "anthropic:opus", inputPerToken: 5, outputPerToken: 25, cacheReadPerToken: 0.5, cacheCreationPerToken: 6.25 } },
  { matches: /^deepseek\/deepseek-v4-flash$/i, prices: { key: "nous:deepseek-v4-flash:2026-07-19", inputPerToken: 0.098, outputPerToken: 0.196, cacheReadPerToken: 0.0196, cacheCreationPerToken: 0.098 } },
];

export function pricesForModel(modelId: string): ModelTokenPrices | null {
  return MODEL_PRICE_TABLE.find((entry) => entry.matches.test(modelId))?.prices ?? null;
}

/** A turn's cost in micro-USD, rounded up so fractional turns still spend. */
export function costOfTurn(usage: TokenUsageBreakdown, prices: ModelTokenPrices = TOKEN_PRICES_MICROS): number {
  return Math.ceil(
    usage.inputTokens * prices.inputPerToken +
      usage.outputTokens * prices.outputPerToken +
      usage.cacheReadInputTokens * prices.cacheReadPerToken +
      usage.cacheCreationInputTokens * prices.cacheCreationPerToken,
  );
}

const MAX_OUTPUT_TOKENS = { classify: 2_048, runAgent: 4_096, streamAgent: 16_000, generate: 4_096 } as const;

const ESTIMATED_BYTES_PER_TOKEN = 4;

/**
 * Conservative-enough admission estimate: common model tokenisers average
 * roughly four UTF-8 bytes per token. The request byte ceiling remains the
 * hard resource bound; reservations protect concurrent quota without making
 * a maximum-size request impossible for a fresh account.
 */
export function maximumTurnCost(
  inputBytes: number,
  primitive: keyof typeof MAX_OUTPUT_TOKENS,
  prices: ModelTokenPrices,
): number {
  const maximumInputPrice = Math.max(
    prices.inputPerToken,
    prices.cacheReadPerToken,
    prices.cacheCreationPerToken,
  );
  const estimatedInputTokens = Math.ceil(inputBytes / ESTIMATED_BYTES_PER_TOKEN);
  return Math.ceil(estimatedInputTokens * maximumInputPrice + MAX_OUTPUT_TOKENS[primitive] * prices.outputPerToken);
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
export const QUOTA_REQUEST_TOO_LARGE_MESSAGE = "There isn't enough free quota left for a request this size.";

/** Burst guard: per-user, per-capability requests admitted each minute. */
export const REQUEST_RATE_LIMIT: RateLimitPolicy = {
  maxRequests: 12,
  windowMs: 60_000,
};

/** May this user spend right now? One question: is there quota left. */
export function checkQuota(snapshot: UsageSnapshot): CapDecision {
  if (snapshot.costMicrosUsed + snapshot.costMicrosReserved >= INITIAL_QUOTA_MICROS) {
    return { allowed: false, reason: QUOTA_EXHAUSTED_MESSAGE };
  }
  return { allowed: true };
}

/** Fold a turn's token cost into a snapshot (pure). */
export function applyTurn(snapshot: UsageSnapshot, usage: TokenUsageBreakdown, prices: ModelTokenPrices = TOKEN_PRICES_MICROS): UsageSnapshot {
  const tokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadInputTokens +
    usage.cacheCreationInputTokens;
  return {
    ...snapshot,
    tokensUsed: snapshot.tokensUsed + tokens,
    turnsUsed: snapshot.turnsUsed + 1,
    costMicrosUsed: snapshot.costMicrosUsed + costOfTurn(usage, prices),
    inputTokensUsed: snapshot.inputTokensUsed + usage.inputTokens,
    outputTokensUsed: snapshot.outputTokensUsed + usage.outputTokens,
    cacheReadInputTokensUsed: snapshot.cacheReadInputTokensUsed + usage.cacheReadInputTokens,
    cacheCreationInputTokensUsed:
      snapshot.cacheCreationInputTokensUsed + usage.cacheCreationInputTokens,
  };
}
