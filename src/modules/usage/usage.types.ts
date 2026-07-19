import type { UserId } from "@/shared";

/**
 * Capabilities a model call can spend on. Carried on the accounting tag for
 * per-capability request rate limiting and cost attribution — admission itself
 * is capability-blind: one free quota, every capability (ARCHITECTURE §8).
 */
export type GatedCapability =
  | "build"
  | "visualise"
  | "metadata-suggest"
  | "test-run"
  | "triggering-eval"
  | "safety-review"
  | "export"
  | "import"
  | "publish";

/** The running counters for a user (ARCHITECTURE §6). */
export type TokenUsageBreakdown = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
};

export type UsageSnapshot = {
  readonly userId: UserId;
  /** Total model tokens spent. Detailed buckets support the price table. */
  readonly tokensUsed: number;
  readonly turnsUsed: number;
  /** Money spent against the free quota, in micro-USD, priced at record time. */
  readonly costMicrosUsed: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
  readonly cacheReadInputTokensUsed: number;
  readonly cacheCreationInputTokensUsed: number;
};

/** Fixed-window request-rate policy, enforced before model spend. */
export type RateLimitPolicy = {
  readonly maxRequests: number;
  readonly windowMs: number;
};

/** The answer to "may this user do X right now?" */
export type CapDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };
