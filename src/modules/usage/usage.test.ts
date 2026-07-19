import { describe, it, expect } from "vitest";
import { checkQuota, applyTurn, costOfTurn, quotaRemainingMicros, INITIAL_QUOTA_MICROS, pricesForModel } from "./meter";
import type { TokenUsageBreakdown, UsageSnapshot } from "./usage.types";
import { UserId } from "@/shared";

const fresh: UsageSnapshot = {
  userId: UserId("u1"),
  tokensUsed: 0,
  turnsUsed: 0,
  costMicrosUsed: 0,
  costMicrosReserved: 0,
  inputTokensUsed: 0,
  outputTokensUsed: 0,
  cacheReadInputTokensUsed: 0,
  cacheCreationInputTokensUsed: 0,
};

describe("usage meter", () => {
  it("allows spend while free quota remains", () => {
    expect(checkQuota(fresh)).toEqual({ allowed: true });
    expect(checkQuota({ ...fresh, costMicrosUsed: INITIAL_QUOTA_MICROS - 1 }).allowed).toBe(true);
  });

  it("denies spend once the free quota is used up", () => {
    const decision = checkQuota({ ...fresh, costMicrosUsed: INITIAL_QUOTA_MICROS });
    expect(decision.allowed).toBe(false);
  });

  it("prices a turn per token bucket, rounded up", () => {
    const usage: TokenUsageBreakdown = {
      inputTokens: 100, // 300 micros
      outputTokens: 10, // 150 micros
      cacheReadInputTokens: 5, // 1.5 micros
      cacheCreationInputTokens: 2, // 7.5 micros
    };
    expect(costOfTurn(usage)).toBe(459); // ceil(300 + 150 + 1.5 + 7.5)
  });

  it("selects prices from the resolved model and fails closed for unknown models", () => {
    expect(pricesForModel("claude-haiku-4-5")?.inputPerToken).toBe(1);
    expect(pricesForModel("claude-sonnet-4-6")?.inputPerToken).toBe(3);
    expect(pricesForModel("claude-opus-4-8")?.outputPerToken).toBe(25);
    expect(pricesForModel("deepseek/deepseek-v4-flash")?.inputPerToken).toBe(0.098);
    expect(pricesForModel("unknown/model")).toBeNull();
  });

  it("reports the remaining quota, floored at zero", () => {
    expect(quotaRemainingMicros(fresh)).toBe(INITIAL_QUOTA_MICROS);
    expect(quotaRemainingMicros({ ...fresh, costMicrosUsed: 400_000 })).toBe(600_000);
    expect(quotaRemainingMicros({ ...fresh, costMicrosUsed: INITIAL_QUOTA_MICROS + 500 })).toBe(0);
  });

  it("accumulates tokens, turns, cost, and token buckets", () => {
    const first: TokenUsageBreakdown = {
      inputTokens: 80,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 10,
    };
    const second: TokenUsageBreakdown = {
      inputTokens: 25,
      outputTokens: 15,
      cacheReadInputTokens: 35,
      cacheCreationInputTokens: 0,
    };
    const next = applyTurn(applyTurn(fresh, first), second);
    expect(next.tokensUsed).toBe(185);
    expect(next.turnsUsed).toBe(2);
    expect(next.costMicrosUsed).toBe(costOfTurn(first) + costOfTurn(second));
    expect(next.inputTokensUsed).toBe(105);
    expect(next.outputTokensUsed).toBe(35);
    expect(next.cacheReadInputTokensUsed).toBe(35);
    expect(next.cacheCreationInputTokensUsed).toBe(10);
  });
});
