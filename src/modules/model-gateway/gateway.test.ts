import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createModelGateway } from "./gateway";
import { PROVIDER_CAP_REACHED_MESSAGE } from "./raw-model-calls";
import type {
  RawModelCalls,
  RawCallResult,
  RawAgentStream,
  RawAgentStreamPart,
} from "./raw-model-calls";
import type { AccountingTag, Classification } from "./gateway.types";
import { createMemoryRequestRateLimiter } from "@/infra/memory/rate-limit.memory-repository";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { INITIAL_QUOTA_MICROS, TOKEN_PRICES_MICROS } from "@/modules/usage";
import type { TokenUsageBreakdown } from "@/modules/usage";
import type { ModelRouter, ResolvedModel } from "@/modules/model-router";
import { ok, err, domainError, isErr, REQUEST_BYTES_MAX, UserId } from "@/shared";

/**
 * Policy tests for the domain accounting shell (#160): admission (free quota,
 * rate limit, byte budget), recording, and the stream record-once discipline — run
 * through the `ModelGateway` interface against memory usage/rate-limit
 * adapters and a fake raw-calls port. No `vi.mock("ai")`: SDK translation is
 * the adapter's concern (`sdk-model-calls.test.ts`).
 */

const resolved = (id = "resolved"): ResolvedModel => ({
  model: { id } as unknown as ResolvedModel["model"],
  providerId: "anthropic",
  kind: "anthropic",
  modelId: "claude-sonnet-4-6",
  viaOverride: false,
  structuredOutputs: "json-schema",
});

/** A router that always resolves — enough to pass admission. */
function stubRouter(overrides?: Partial<ModelRouter>): ModelRouter {
  return {
    hasModel: () => true,
    snapshot: () => ({ providers: [], active: { providerId: "anthropic" } }),
    setActive: () => {
      throw new Error("not under test");
    },
    setCredential: () => {
      throw new Error("not under test");
    },
    clearCredential: () => {
      throw new Error("not under test");
    },
    resolve: () => ok(resolved()),
    ...overrides,
  } as ModelRouter;
}

const offlineRouter = stubRouter({
  hasModel: () => false,
  resolve: () => err(domainError("model_unavailable", "No model is configured.")),
});

const usageOf = (
  inputTokens: number,
  outputTokens = 0,
  cacheReadInputTokens = 0,
  cacheCreationInputTokens = 0,
): TokenUsageBreakdown => ({
  inputTokens,
  outputTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
});

const classification: Classification = { choice: "a", rationale: "fits" };

function rawResult<T>(value: T, usage = usageOf(0, 1)): RawCallResult<T> {
  return { value, usage };
}

/** A raw-calls fake: every primitive succeeds with the given usage. */
function fakeCalls(overrides?: Partial<RawModelCalls>): RawModelCalls {
  return {
    classify: vi.fn(async () => ok(rawResult(classification))),
    runAgent: vi.fn(async () => ok(rawResult({ transcript: [] }))),
    streamAgent: vi.fn(() => rawStream([{ kind: "finish", finishReason: "stop" }])),
    generate: vi.fn(async () => ok(rawResult({ ok: true }))),
    ...overrides,
  } as RawModelCalls;
}

function rawStream(
  parts: readonly RawAgentStreamPart[],
  options?: { usage?: TokenUsageBreakdown; throwAfter?: unknown },
): RawAgentStream {
  async function* generate(): AsyncGenerator<RawAgentStreamPart> {
    for (const part of parts) yield part;
    if (options?.throwAfter) throw options.throwAfter;
  }
  return {
    parts: generate(),
    usage: async () => options?.usage ?? usageOf(0, 1),
  };
}

const account = (id: string): AccountingTag => ({
  kind: "account",
  userId: UserId(id),
  capability: "test-run",
});
const platform: AccountingTag = { kind: "platform", reason: "test" };

/** Enough input tokens to price past the whole free quota in one turn. */
const QUOTA_EXHAUSTING_INPUT_TOKENS = Math.ceil(
  INITIAL_QUOTA_MICROS / TOKEN_PRICES_MICROS.inputPerToken,
);

function gatewayWith(deps?: {
  calls?: RawModelCalls;
  usage?: ReturnType<typeof createMemoryUsageRepository>;
  router?: ModelRouter;
}) {
  return createModelGateway({
    router: deps?.router ?? stubRouter(),
    calls: deps?.calls ?? fakeCalls(),
    usage: deps?.usage ?? createMemoryUsageRepository(),
  });
}

describe("model gateway — accounting guard", () => {
  it("fails model_unavailable when no model is configured", async () => {
    const gateway = gatewayWith({ router: offlineRouter });
    expect(gateway.hasModel).toBe(false);

    const result = await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });

  it("fails every primitive with model_unavailable offline, before any raw call", async () => {
    const calls = fakeCalls();
    const gateway = gatewayWith({ router: offlineRouter, calls });

    const c = await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    const r = await gateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    const s = await gateway.streamAgent({ system: "", messages: [], tools: [], tag: platform });
    const g = await gateway.generate({
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });

    expect(isErr(c) && c.error.tag).toBe("model_unavailable");
    expect(isErr(r) && r.error.tag).toBe("model_unavailable");
    expect(isErr(s) && s.error.tag).toBe("model_unavailable");
    expect(isErr(g) && g.error.tag).toBe("model_unavailable");
    expect(calls.classify).not.toHaveBeenCalled();
    expect(calls.runAgent).not.toHaveBeenCalled();
    expect(calls.streamAgent).not.toHaveBeenCalled();
    expect(calls.generate).not.toHaveBeenCalled();
  });

  it("fails cap_reached when an account call has used up its free quota", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    // Spend enough that the priced cost exceeds the whole quota.
    await usage.increment(UserId(userId), {
      usage: usageOf(QUOTA_EXHAUSTING_INPUT_TOKENS),
      turns: 0,
    });
    const calls = fakeCalls();
    const gateway = gatewayWith({ usage, calls });

    const result = await gateway.classify({ prompt: "x", choices: ["a"], tag: account(userId) });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("cap_reached");
    expect(calls.classify).not.toHaveBeenCalled();
  });

  it("admits every capability while quota remains — admission is capability-blind", async () => {
    // Under quota, even the most expensive capabilities are open (ARCHITECTURE
    // §8): the quota, not a per-capability allowlist, is the spend decision.
    const gateway = gatewayWith();

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId: UserId("fresh-user"), capability: "triggering-eval" },
    });
    expect(isErr(result)).toBe(false);
  });

  it("does not quota-gate platform calls (the platform owns that cost)", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    await usage.increment(UserId(userId), {
      usage: usageOf(QUOTA_EXHAUSTING_INPUT_TOKENS),
      turns: 0,
    });
    const gateway = gatewayWith({ usage });

    const result = await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    expect(isErr(result)).toBe(false);
    // ...and platform spend never lands on a user's meter.
    const snapshot = await usage.get(UserId(userId));
    if (!isErr(snapshot)) expect(snapshot.value.turnsUsed).toBe(0);
  });

  it("rate-limits account calls per user and capability, then recovers after the window", async () => {
    let now = 0;
    const gateway = createModelGateway({
      router: stubRouter(),
      calls: fakeCalls(),
      usage: createMemoryUsageRepository(),
      requestRateLimiter: createMemoryRequestRateLimiter({ now: () => now }),
      requestRateLimit: { maxRequests: 2, windowMs: 1_000 },
    });

    const first = await gateway.classify({ prompt: "x", choices: ["a"], tag: account("fast") });
    const second = await gateway.classify({ prompt: "x", choices: ["a"], tag: account("fast") });
    const third = await gateway.classify({ prompt: "x", choices: ["a"], tag: account("fast") });
    now = 1_000;
    const recovered = await gateway.classify({ prompt: "x", choices: ["a"], tag: account("fast") });

    expect(isErr(first)).toBe(false);
    expect(isErr(second)).toBe(false);
    expect(isErr(third)).toBe(true);
    if (isErr(third)) {
      expect(third.error.tag).toBe("cap_reached");
      expect(third.error.message).toContain("going a little fast");
    }
    expect(isErr(recovered)).toBe(false);
  });
});

describe("model gateway — router resolution", () => {
  it("resolves through the router per primitive and hands the raw port the resolved model", async () => {
    const models = {
      classify: resolved("classify"),
      runAgent: resolved("runAgent"),
      streamAgent: resolved("streamAgent"),
      generate: resolved("generate"),
    };
    const router = stubRouter({
      resolve: vi.fn((primitive: keyof typeof models) => ok(models[primitive])),
    });
    const calls = fakeCalls();
    const gateway = gatewayWith({ router, calls });

    await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    await gateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    const opened = await gateway.streamAgent({ system: "", messages: [], tools: [], tag: platform });
    if (!isErr(opened)) await collect(opened.value);
    await gateway.generate({
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });

    expect(calls.classify).toHaveBeenCalledWith(models.classify, expect.anything());
    expect(calls.runAgent).toHaveBeenCalledWith(models.runAgent, expect.anything());
    expect(calls.streamAgent).toHaveBeenCalledWith(models.streamAgent, expect.anything());
    expect(calls.generate).toHaveBeenCalledWith(models.generate, expect.anything());
  });

  it("routes a call to an explicit target selection without changing the active provider", async () => {
    const router = stubRouter({
      resolve: vi.fn((_primitive, selection) =>
        ok(resolved(selection?.providerId === "target" ? "target-classify" : "active-classify")),
      ),
    });
    const calls = fakeCalls();
    const gateway = gatewayWith({ router, calls });

    await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: platform,
      target: { providerId: "target" },
    });
    await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });

    expect(router.resolve).toHaveBeenNthCalledWith(1, "classify", { providerId: "target" });
    expect(router.resolve).toHaveBeenNthCalledWith(2, "classify", undefined);
    expect(calls.classify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: { id: "target-classify" } }),
      expect.anything(),
    );
    expect(calls.classify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: { id: "active-classify" } }),
      expect.anything(),
    );
  });
});

describe("model gateway — input budget guard", () => {
  it("admits payloads at the gateway byte ceiling", async () => {
    const calls = fakeCalls();
    const gateway = gatewayWith({ calls });

    const result = await gateway.classify({
      prompt: "x".repeat(REQUEST_BYTES_MAX),
      choices: ["a"],
      tag: platform,
    });

    expect(isErr(result)).toBe(false);
    expect(calls.classify).toHaveBeenCalledOnce();
  });

  it("rejects payloads over the gateway byte ceiling before any raw call", async () => {
    const calls = fakeCalls();
    const gateway = gatewayWith({ calls });
    const oversized = "x".repeat(REQUEST_BYTES_MAX + 1);

    const classify = await gateway.classify({ prompt: oversized, choices: ["a"], tag: platform });
    const runAgent = await gateway.runAgent({
      system: "s",
      messages: [{ role: "user", content: oversized }],
      tools: [],
      tag: platform,
    });
    const streamAgent = await gateway.streamAgent({
      system: oversized,
      messages: [],
      tools: [],
      tag: platform,
    });
    const generate = await gateway.generate({
      system: "s",
      prompt: oversized,
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });

    for (const result of [classify, runAgent, streamAgent, generate]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.tag).toBe("input_too_large");
    }
    expect(calls.classify).not.toHaveBeenCalled();
    expect(calls.runAgent).not.toHaveBeenCalled();
    expect(calls.streamAgent).not.toHaveBeenCalled();
    expect(calls.generate).not.toHaveBeenCalled();
  });
});

describe("model gateway — recording", () => {
  it("records account token buckets and a turn after a successful call", async () => {
    const usage = createMemoryUsageRepository();
    const userId = UserId("cache-aware");
    const calls = fakeCalls({
      classify: vi.fn(async () => ok(rawResult(classification, usageOf(40, 30, 70, 10)))),
    });
    const gateway = gatewayWith({ usage, calls });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(result)).toBe(false);
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) {
      expect(snapshot.value).toMatchObject({
        tokensUsed: 150,
        turnsUsed: 1,
        inputTokensUsed: 40,
        outputTokensUsed: 30,
        cacheReadInputTokensUsed: 70,
        cacheCreationInputTokensUsed: 10,
      });
    }
  });

  it("records nothing when the raw call fails", async () => {
    const usage = createMemoryUsageRepository();
    const userId = UserId("raw-failed");
    const calls = fakeCalls({
      classify: vi.fn(async () => err(domainError("model_unavailable", "boom"))),
    });
    const gateway = gatewayWith({ usage, calls });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(result)).toBe(true);
    const snapshot = await usage.get(userId);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 0, turnsUsed: 0 });
  });

  it("passes a provider cap failure through without recording usage", async () => {
    const usage = createMemoryUsageRepository();
    const userId = UserId("provider-capped");
    const calls = fakeCalls({
      classify: vi.fn(async () =>
        err(domainError("cap_reached", PROVIDER_CAP_REACHED_MESSAGE)),
      ),
    });
    const gateway = gatewayWith({ usage, calls });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.tag).toBe("cap_reached");
      expect(result.error.message).toContain("cap_reached");
    }
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 0, turnsUsed: 0 });
  });

  it("nulls a classify choice outside the allowed set", async () => {
    const calls = fakeCalls({
      classify: vi.fn(async () =>
        ok(rawResult({ choice: "hallucinated", rationale: "made up" })),
      ),
    });
    const gateway = gatewayWith({ calls });

    const result = await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value).toEqual({ choice: null, rationale: "made up" });
    }
  });
});

describe("model gateway — stream accounting", () => {
  const accountTag = (id: string): AccountingTag => ({
    kind: "account",
    userId: UserId(id),
    capability: "test-run",
  });

  it("records stream usage once after a clean settle", async () => {
    const usage = createMemoryUsageRepository();
    const calls = fakeCalls({
      streamAgent: vi.fn(() =>
        rawStream(
          [
            { kind: "text", delta: "hello" },
            { kind: "finish", finishReason: "stop" },
          ],
          { usage: usageOf(0, 31) },
        ),
      ),
    });
    const gateway = gatewayWith({ usage, calls });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: accountTag("stream-clean"),
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      expect(await collect(opened.value)).toEqual([
        { kind: "text", delta: "hello" },
        { kind: "finish", finishReason: "stop" },
      ]);
    }
    const snapshot = await usage.get(UserId("stream-clean"));
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 31, turnsUsed: 1 });
  });

  it("records the best-known stream usage when the stream throws", async () => {
    const usage = createMemoryUsageRepository();
    const calls = fakeCalls({
      streamAgent: vi.fn(() =>
        rawStream([{ kind: "text", delta: "before" }], {
          usage: usageOf(0, 12),
          throwAfter: new Error("stream failed"),
        }),
      ),
    });
    const gateway = gatewayWith({ usage, calls });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: accountTag("stream-error"),
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) await expect(collect(opened.value)).rejects.toThrow("stream failed");
    const snapshot = await usage.get(UserId("stream-error"));
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 12, turnsUsed: 1 });
  });

  it("records the best-known stream usage when the client stops consuming", async () => {
    const usage = createMemoryUsageRepository();
    const calls = fakeCalls({
      streamAgent: vi.fn(() =>
        rawStream(
          [
            { kind: "text", delta: "partial" },
            { kind: "text", delta: "unread" },
          ],
          { usage: usageOf(0, 9) },
        ),
      ),
    });
    const gateway = gatewayWith({ usage, calls });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: accountTag("stream-abort"),
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      await opened.value.next();
      await opened.value.return(undefined);
    }
    const snapshot = await usage.get(UserId("stream-abort"));
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 9, turnsUsed: 1 });
  });

  it("maps a provider cap part to the domain cap message and skips recording", async () => {
    const usage = createMemoryUsageRepository();
    const calls = fakeCalls({
      streamAgent: vi.fn(() => rawStream([{ kind: "provider-cap-error" }])),
    });
    const gateway = gatewayWith({ usage, calls });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: accountTag("stream-provider-capped"),
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      expect(await collect(opened.value)).toEqual([
        { kind: "error", message: PROVIDER_CAP_REACHED_MESSAGE },
      ]);
    }
    const snapshot = await usage.get(UserId("stream-provider-capped"));
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 0, turnsUsed: 0 });
  });

  it("records usage for a regular provider error part", async () => {
    const usage = createMemoryUsageRepository();
    const calls = fakeCalls({
      streamAgent: vi.fn(() =>
        rawStream(
          [{ kind: "error", message: "The provider rate-limited this request." }],
          { usage: usageOf(0, 6) },
        ),
      ),
    });
    const gateway = gatewayWith({ usage, calls });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: accountTag("stream-provider-transient"),
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      expect(await collect(opened.value)).toEqual([
        { kind: "error", message: "The provider rate-limited this request." },
      ]);
    }
    const snapshot = await usage.get(UserId("stream-provider-transient"));
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 6, turnsUsed: 1 });
  });
});

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const part of generator) out.push(part);
  return out;
}
