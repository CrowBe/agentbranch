import { describe, it, expect } from "vitest";
import { checkCap, applyTurn } from "./meter";
import type { TokenUsageBreakdown, UsageSnapshot } from "./usage.types";
import { UserId } from "@/shared";

const fresh: UsageSnapshot = {
  userId: UserId("u1"),
  tokensUsed: 0,
  turnsUsed: 0,
  inputTokensUsed: 0,
  outputTokensUsed: 0,
  cacheReadInputTokensUsed: 0,
  cacheCreationInputTokensUsed: 0,
};

describe("usage meter", () => {
  it("allows a build on the free tier when under caps", () => {
    expect(checkCap(fresh, "free", "build")).toEqual({ allowed: true });
  });

  it("denies triggering-eval on free but allows it on pro", () => {
    expect(checkCap(fresh, "free", "triggering-eval").allowed).toBe(false);
    expect(checkCap(fresh, "pro", "triggering-eval").allowed).toBe(true);
  });

  it("allows import on the free tier because storage is capped separately", () => {
    expect(checkCap(fresh, "free", "import")).toEqual({ allowed: true });
  });

  it("denies once the turn cap is hit", () => {
    const maxed: UsageSnapshot = { ...fresh, turnsUsed: 25 };
    const decision = checkCap(maxed, "free", "build");
    expect(decision.allowed).toBe(false);
  });

  it("accumulates tokens, turns, and token buckets", () => {
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
    expect(next.inputTokensUsed).toBe(105);
    expect(next.outputTokensUsed).toBe(35);
    expect(next.cacheReadInputTokensUsed).toBe(35);
    expect(next.cacheCreationInputTokensUsed).toBe(10);
  });
});
