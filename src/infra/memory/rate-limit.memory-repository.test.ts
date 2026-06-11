import { describe, expect, it } from "vitest";
import { UserId, unwrap } from "@/shared";
import { createMemoryRequestRateLimiter, RATE_LIMIT_MESSAGE } from "./rate-limit.memory-repository";

describe("memory request rate limiter", () => {
  it("does not allow a concurrent burst to exceed the fixed-window cap", async () => {
    const limiter = createMemoryRequestRateLimiter();
    const policy = { maxRequests: 3, windowMs: 60_000 };

    const decisions = await Promise.all(
      Array.from({ length: 8 }, () => limiter.consume(UserId("u1"), "build", policy)),
    );

    const values = decisions.map(unwrap);
    expect(values.filter((decision) => decision.allowed)).toHaveLength(policy.maxRequests);
    expect(values.filter((decision) => !decision.allowed)).toEqual(
      Array.from({ length: 5 }, () => ({ allowed: false, reason: RATE_LIMIT_MESSAGE })),
    );
  });
});
