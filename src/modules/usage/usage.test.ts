import { describe, it, expect } from "vitest";
import { checkCap, applyTurn } from "./meter";
import type { UsageSnapshot } from "./usage.types";
import { UserId } from "@/shared";

const fresh: UsageSnapshot = { userId: UserId("u1"), tokensUsed: 0, turnsUsed: 0 };

describe("usage meter", () => {
  it("allows a build on the free tier when under caps", () => {
    expect(checkCap(fresh, "free", "build")).toEqual({ allowed: true });
  });

  it("denies triggering-eval on free but allows it on pro", () => {
    expect(checkCap(fresh, "free", "triggering-eval").allowed).toBe(false);
    expect(checkCap(fresh, "pro", "triggering-eval").allowed).toBe(true);
  });

  it("denies once the turn cap is hit", () => {
    const maxed: UsageSnapshot = { ...fresh, turnsUsed: 25 };
    const decision = checkCap(maxed, "free", "build");
    expect(decision.allowed).toBe(false);
  });

  it("accumulates tokens and turns", () => {
    const next = applyTurn(applyTurn(fresh, 100), 50);
    expect(next.tokensUsed).toBe(150);
    expect(next.turnsUsed).toBe(2);
  });
});
