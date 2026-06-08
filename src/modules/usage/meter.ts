import type {
  Tier,
  TierLimits,
  GatedCapability,
  UsageSnapshot,
  CapDecision,
  RateLimitPolicy,
} from "./usage.types";

/**
 * Tier limits. Free is intentionally tight: one bounded session, no triggering
 * evals, no import (ARCHITECTURE §8). The token meter exists day one to enforce
 * caps and to be reused for PAYG metering later (ARCHITECTURE §4).
 */
export const TIER_LIMITS: Readonly<Record<Tier, TierLimits>> = {
  free: {
    maxTurns: 25,
    maxTokens: 200_000,
    allowed: new Set<GatedCapability>(["build", "visualise", "test-run", "export"]),
  },
  pro: {
    maxTurns: 1_000,
    maxTokens: 10_000_000,
    allowed: new Set<GatedCapability>([
      "build",
      "visualise",
      "test-run",
      "triggering-eval",
      "export",
      "import",
    ]),
  },
};

/** Burst guard: per-user, per-capability requests admitted each minute. */
export const REQUEST_RATE_LIMIT: RateLimitPolicy = {
  maxRequests: 12,
  windowMs: 60_000,
};

const ALLOW: CapDecision = { allowed: true };
const deny = (reason: string): CapDecision => ({ allowed: false, reason });

/** May this user use a capability, given their tier and current usage? */
export function checkCap(
  snapshot: UsageSnapshot,
  tier: Tier,
  capability: GatedCapability,
): CapDecision {
  const limits = TIER_LIMITS[tier];

  if (!limits.allowed.has(capability)) {
    return deny(`${capability} isn't available on the ${tier} plan.`);
  }
  if (snapshot.turnsUsed >= limits.maxTurns) {
    return deny("You've reached this session's turn limit.");
  }
  if (snapshot.tokensUsed >= limits.maxTokens) {
    return deny("You're out of free usage for today — back tomorrow.");
  }
  return ALLOW;
}

/** Fold a turn's token cost into a snapshot (pure). */
export function applyTurn(snapshot: UsageSnapshot, tokens: number): UsageSnapshot {
  return {
    ...snapshot,
    tokensUsed: snapshot.tokensUsed + tokens,
    turnsUsed: snapshot.turnsUsed + 1,
  };
}
