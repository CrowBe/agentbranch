import type { UserId } from "@/shared";

/** Subscription tiers (Clerk Billing). v1 = Free + one Pro (ARCHITECTURE §4). */
export type Tier = "free" | "pro";

/** Capabilities that can be gated by tier. */
export type GatedCapability =
  | "build"
  | "visualise"
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
  /** Total model tokens for cap checks. Detailed buckets support pricing later. */
  readonly tokensUsed: number;
  readonly turnsUsed: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
  readonly cacheReadInputTokensUsed: number;
  readonly cacheCreationInputTokensUsed: number;
};

/** Per-tier caps. A free session is bounded by construction (ARCHITECTURE §8). */
export type TierLimits = {
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly allowed: ReadonlySet<GatedCapability>;
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
