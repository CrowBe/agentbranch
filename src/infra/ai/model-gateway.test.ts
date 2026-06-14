import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { z } from "zod";
import { createModelGateway } from "./model-gateway";
import { createMemoryRequestRateLimiter } from "@/infra/memory/rate-limit.memory-repository";
import { createMemoryUsageRepository } from "@/infra/memory/usage.memory-repository";
import { TIER_LIMITS } from "@/modules/usage";
import type { ModelProvider, AccountingTag } from "@/modules/model-gateway";
import { isErr, REQUEST_BYTES_MAX, UserId } from "@/shared";
import type { TokenUsageBreakdown } from "@/modules/usage";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  generateObject: vi.fn(async () => {
    throw new Error("mock generateObject failure");
  }),
  generateText: vi.fn(async () => {
    throw new Error("mock generateText failure");
  }),
}));

vi.mock("ai", () => ({
  generateObject: aiMocks.generateObject,
  generateText: aiMocks.generateText,
  streamText: aiMocks.streamText,
  tool: vi.fn((definition) => definition),
  stepCountIs: vi.fn((count: number) => ({ count })),
  jsonSchema: vi.fn((schema) => schema),
}));

/** A provider with a truthy model — enough to pass the no-model guard. The
 *  accounting checks under test all resolve *before* any SDK call, so the model
 *  is never actually invoked here. */
const withModel: ModelProvider = { model: {} as ModelProvider["model"] };
const noModel: ModelProvider = { model: null };
const routedProvider = {
  model: model("default"),
  models: {
    classify: model("classify"),
    generate: model("generate"),
    runAgent: model("runAgent"),
    streamAgent: model("streamAgent"),
  },
} satisfies ModelProvider;

const account = (id: string): AccountingTag => ({
  kind: "account",
  userId: UserId(id),
  capability: "test-run",
});
const platform: AccountingTag = { kind: "platform", reason: "test" };
const usageBreakdown = (
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model gateway — accounting guard", () => {
  it("fails model_unavailable when no model is configured", async () => {
    const gateway = createModelGateway({
      provider: noModel,
      usage: createMemoryUsageRepository(),
    });
    expect(gateway.hasModel).toBe(false);

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: platform,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });

  it("fails cap_reached when an account call is over its tier cap", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    // Push the user past the free token cap so checkCap denies.
    await usage.increment(UserId(userId), {
      usage: usageBreakdown(TIER_LIMITS.free.maxTokens),
      turns: 0,
    });
    const gateway = createModelGateway({ provider: withModel, usage });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: account(userId),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("cap_reached");
  });

  it("gates against the capability the caller declares, not a fixed one", async () => {
    // A user well under the free token + turn budget, but running a capability
    // the free tier disallows (triggering-eval, ARCHITECTURE §8). The gateway
    // must read the cap from the tag — gating it — rather than admitting it
    // under some hardcoded capability.
    const usage = createMemoryUsageRepository();
    const gateway = createModelGateway({ provider: withModel, usage });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId: UserId("free-user"), capability: "triggering-eval" },
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("cap_reached");
  });

  it("admits Pro users for triggering eval", async () => {
    aiMocks.generateObject.mockResolvedValueOnce({
      object: { choice: "a", rationale: "fits" },
      usage: { totalTokens: 1 },
    } as never);
    const usage = createMemoryUsageRepository();
    const gateway = createModelGateway({
      provider: withModel,
      usage,
      tierFor: async () => "pro",
    });

    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: { kind: "account", userId: UserId("pro-user"), capability: "triggering-eval" },
    });

    expect(isErr(result)).toBe(false);
  });

  it("does not cap-gate platform calls (the platform owns that cost)", async () => {
    const usage = createMemoryUsageRepository();
    const userId = "capped";
    await usage.increment(UserId(userId), {
      usage: usageBreakdown(TIER_LIMITS.free.maxTokens),
      turns: 0,
    });
    const gateway = createModelGateway({ provider: withModel, usage });

    // A platform-tagged call skips the cap; with a fake model it fails at the
    // SDK call, *not* with cap_reached. We only assert the failure is NOT a cap.
    const result = await gateway.classify({
      prompt: "x",
      choices: ["a"],
      tag: platform,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).not.toBe("cap_reached");
  });

  it("rate-limits account calls per user and capability, then recovers after the window", async () => {
    aiMocks.generateObject.mockResolvedValue({
      object: { choice: "a", rationale: "fits" },
      usage: { totalTokens: 1 },
    } as never);
    let now = 0;
    const gateway = createModelGateway({
      provider: withModel,
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

describe("model gateway — primitive routing", () => {
  it("uses the configured model route for each primitive", async () => {
    aiMocks.generateObject.mockResolvedValue({
      object: { choice: "a", rationale: "fits" },
      usage: { totalTokens: 1 },
    } as never);
    aiMocks.generateText.mockResolvedValue({ steps: [], usage: { totalTokens: 1 } } as never);
    aiMocks.streamText.mockReturnValue({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 1 }),
    });
    const gateway = createModelGateway({
      provider: routedProvider,
      usage: createMemoryUsageRepository(),
    });

    await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    await gateway.generate({ system: "", prompt: "x", schema: z.object({ choice: z.string(), rationale: z.string() }), tag: platform });
    await gateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    const opened = await gateway.streamAgent({ system: "", messages: [], tools: [], tag: platform });
    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) await collect(opened.value);

    expect(aiMocks.generateObject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: routedProvider.models.classify }),
    );
    expect(aiMocks.generateObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: routedProvider.models.generate }),
    );
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: routedProvider.models.runAgent }),
    );
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ model: routedProvider.models.streamAgent }),
    );
  });
});

describe("model gateway — provider cap errors", () => {
  it("maps provider quota failures to cap_reached instead of model_unavailable", async () => {
    aiMocks.generateObject.mockRejectedValueOnce({
      status: 429,
      message: "Anthropic rate limit exceeded",
    });
    const usage = createMemoryUsageRepository();
    const userId = UserId("provider-capped");
    const gateway = createModelGateway({ provider: withModel, usage });

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

  it("streams a cap_reached error event for provider quota failures without recording usage", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: throwingParts([], { statusCode: 429, message: "quota exceeded" }),
      totalUsage: Promise.resolve({ totalTokens: 0 }),
    });
    const usage = createMemoryUsageRepository();
    const userId = UserId("stream-provider-capped");
    const gateway = createModelGateway({ provider: withModel, usage });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: { kind: "account", userId, capability: "build" },
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      expect(await collect(opened.value)).toEqual([
        { kind: "error", message: "cap_reached: Out of free usage today." },
      ]);
    }
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 0, turnsUsed: 0 });
  });
});

describe("model gateway — input budget guard", () => {
  it("admits payloads at the gateway byte ceiling", async () => {
    aiMocks.generateObject.mockResolvedValueOnce({
      object: { choice: "a", rationale: "fits" },
      usage: { totalTokens: 1 },
    } as never);
    const gateway = createModelGateway({
      provider: withModel,
      usage: createMemoryUsageRepository(),
    });

    const result = await gateway.classify({
      prompt: "x".repeat(REQUEST_BYTES_MAX),
      choices: ["a"],
      tag: platform,
    });

    expect(isErr(result)).toBe(false);
    expect(aiMocks.generateObject).toHaveBeenCalledOnce();
  });

  it("rejects payloads over the gateway byte ceiling before SDK calls", async () => {
    const gateway = createModelGateway({
      provider: withModel,
      usage: createMemoryUsageRepository(),
    });
    const oversized = "x".repeat(REQUEST_BYTES_MAX + 1);

    const classify = await gateway.classify({
      prompt: oversized,
      choices: ["a"],
      tag: platform,
    });
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
    expect(aiMocks.generateObject).not.toHaveBeenCalled();
    expect(aiMocks.generateText).not.toHaveBeenCalled();
    expect(aiMocks.streamText).not.toHaveBeenCalled();
  });
});

function model(id: string): ModelProvider["model"] {
  return { id } as unknown as ModelProvider["model"];
}

describe("model gateway — stream accounting", () => {
  it("records uncached, cached-read, cached-write, and output token buckets", async () => {
    aiMocks.generateObject.mockResolvedValueOnce({
      object: { choice: "a", rationale: "fits" },
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        inputTokenDetails: {
          cacheReadTokens: 70,
          cacheWriteTokens: 10,
        },
      },
    } as never);
    const usage = createMemoryUsageRepository();
    const userId = UserId("cache-aware");
    const gateway = createModelGateway({ provider: withModel, usage });

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

  it("records stream usage once after a clean settle", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([
        { type: "text-delta", text: "hello" },
        { type: "finish", finishReason: "stop" },
      ]),
      totalUsage: Promise.resolve({ totalTokens: 31 }),
    });
    const usage = createMemoryUsageRepository();
    const userId = UserId("stream-clean");
    const gateway = createModelGateway({ provider: withModel, usage });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      expect(await collect(opened.value)).toEqual([
        { kind: "text", delta: "hello" },
        { kind: "finish", finishReason: "stop" },
      ]);
    }
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 31, turnsUsed: 1 });
  });

  it("records the latest known stream usage when the stream throws", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: throwingParts([
        { type: "text-delta", text: "before", usage: { totalTokens: 12 } },
      ]),
      totalUsage: Promise.reject(new Error("usage unavailable")),
    });
    const usage = createMemoryUsageRepository();
    const userId = UserId("stream-error");
    const gateway = createModelGateway({ provider: withModel, usage });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) await expect(collect(opened.value)).rejects.toThrow("stream failed");
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 12, turnsUsed: 1 });
  });

  it("records the latest known stream usage when the client stops consuming", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([
        { type: "text-delta", text: "partial", usage: { totalTokens: 9 } },
        { type: "text-delta", text: "unread", usage: { totalTokens: 20 } },
      ]),
      totalUsage: Promise.reject(new Error("aborted")),
    });
    const usage = createMemoryUsageRepository();
    const userId = UserId("stream-abort");
    const gateway = createModelGateway({ provider: withModel, usage });

    const opened = await gateway.streamAgent({
      system: "",
      messages: [],
      tools: [],
      tag: { kind: "account", userId, capability: "test-run" },
    });

    expect(isErr(opened)).toBe(false);
    if (!isErr(opened)) {
      await opened.value.next();
      await opened.value.return(undefined);
    }
    const snapshot = await usage.get(userId);
    expect(isErr(snapshot)).toBe(false);
    if (!isErr(snapshot)) expect(snapshot.value).toMatchObject({ tokensUsed: 9, turnsUsed: 1 });
  });
});

describe("model gateway — generation controls", () => {
  it("forwards cache control on structured system prompts", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 1 }),
    });
    const gateway = createModelGateway({
      provider: withModel,
      usage: createMemoryUsageRepository(),
    });

    const stream = await gateway.streamAgent({
      system: {
        content: "stable prefix",
        cacheControl: { type: "ephemeral", ttl: "5m" },
      },
      messages: [],
      tools: [],
      tag: platform,
    });
    if (!isErr(stream)) await collect(stream.value);

    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: {
          role: "system",
          content: "stable prefix",
          providerOptions: {
            anthropic: {
              cacheControl: { type: "ephemeral", ttl: "5m" },
            },
          },
        },
      }),
    );
  });

  it("forwards cache control on structured messages", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 1 }),
    });
    const gateway = createModelGateway({
      provider: withModel,
      usage: createMemoryUsageRepository(),
    });

    const stream = await gateway.streamAgent({
      system: "",
      messages: [
        {
          role: "user",
          content: "latest turn",
          cacheControl: { type: "ephemeral" },
        },
      ],
      tools: [],
      tag: platform,
    });
    if (!isErr(stream)) await collect(stream.value);

    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: "latest turn",
            providerOptions: {
              anthropic: {
                cacheControl: { type: "ephemeral" },
              },
            },
          },
        ],
      }),
    );
  });

  it("sets explicit output ceilings on every model primitive", async () => {
    const generateObject = aiMocks.generateObject as Mock;
    const generateText = aiMocks.generateText as Mock;
    generateObject
      .mockResolvedValueOnce({
        object: { choice: "a", rationale: "best match" },
        usage: { totalTokens: 3 },
      })
      .mockResolvedValueOnce({
        object: { ok: true },
        usage: { totalTokens: 5 },
      });
    generateText.mockResolvedValueOnce({
      steps: [],
      usage: { totalTokens: 7 },
    });
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 11 }),
    });
    const gateway = createModelGateway({ provider: withModel, usage: createMemoryUsageRepository() });

    await gateway.classify({ prompt: "x", choices: ["a"], tag: platform });
    await gateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    const stream = await gateway.streamAgent({ system: "", messages: [], tools: [], tag: platform });
    if (!isErr(stream)) await collect(stream.value);
    await gateway.generate({
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });

    expect(aiMocks.generateObject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ maxOutputTokens: 256 }),
    );
    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 4096 }),
    );
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 16000 }),
    );
    expect(aiMocks.generateObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ maxOutputTokens: 2048 }),
    );
  });

  it("adds Anthropic effort only for Sonnet-routed eval and insight primitives", async () => {
    const generateObject = aiMocks.generateObject as Mock;
    const generateText = aiMocks.generateText as Mock;
    generateObject.mockResolvedValueOnce({
      object: { ok: true },
      usage: { totalTokens: 5 },
    });
    generateText.mockResolvedValueOnce({
      steps: [],
      usage: { totalTokens: 7 },
    });
    const gateway = createModelGateway({
      provider: withModel,
      usage: createMemoryUsageRepository(),
      providerKind: "anthropic",
      modelId: "claude-sonnet-4-6",
    });

    await gateway.runAgent({ system: "", messages: [], tools: [], tag: platform });
    await gateway.generate({
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
      tag: platform,
    });

    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { anthropic: { effort: "medium" } },
      }),
    );
    expect(aiMocks.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: { anthropic: { effort: "low" } },
      }),
    );
  });
});

describe("offline gateway (no model configured)", () => {
  it("is offline and fails every primitive with model_unavailable", async () => {
    const gateway = createModelGateway({ provider: noModel, usage: createMemoryUsageRepository() });
    expect(gateway.hasModel).toBe(false);
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
  });
});

async function* parts(values: ReadonlyArray<Record<string, unknown>>) {
  for (const value of values) yield value;
}

async function* throwingParts(
  values: ReadonlyArray<Record<string, unknown>>,
  cause: unknown = new Error("stream failed"),
) {
  for (const value of values) yield value;
  throw cause;
}

async function collect(generator: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const part of generator) out.push(part);
  return out;
}
