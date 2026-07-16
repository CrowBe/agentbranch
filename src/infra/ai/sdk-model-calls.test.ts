import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { z } from "zod";
import { createSdkModelCalls } from "./sdk-model-calls";
import type { ResolvedModel } from "@/modules/model-router";
import { isErr } from "@/shared";

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

/**
 * Translation tests for the raw model-calls adapter (#160): SDK message/tool
 * mapping, output ceilings, effort options, provider cap-error detection, and
 * token-usage shape reading. Accounting policy is the shell's concern
 * (`modules/model-gateway/gateway.test.ts`) and never appears here.
 */

function resolved(overrides?: Partial<ResolvedModel>): ResolvedModel {
  return {
    model: { id: "m" } as unknown as ResolvedModel["model"],
    providerId: "anthropic",
    kind: "anthropic",
    structuredOutputs: "json-schema",
    modelId: "claude-sonnet-4-6",
    viaOverride: false,
    ...overrides,
  };
}

const calls = createSdkModelCalls();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sdk model calls — token usage shapes", () => {
  it("reads uncached, cached-read, cached-write, and output token buckets", async () => {
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

    const result = await calls.classify(resolved(), { prompt: "x", choices: ["a"] });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value.usage).toEqual({
        inputTokens: 40,
        outputTokens: 30,
        cacheReadInputTokens: 70,
        cacheCreationInputTokens: 10,
      });
      expect(result.value.value).toEqual({ choice: "a", rationale: "fits" });
    }
  });

  it("derives input tokens from totals when only totalTokens is present", async () => {
    aiMocks.generateObject.mockResolvedValueOnce({
      object: { choice: "a", rationale: "fits" },
      usage: { totalTokens: 31 },
    } as never);

    const result = await calls.classify(resolved(), { prompt: "x", choices: ["a"] });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value.usage).toMatchObject({ inputTokens: 31, outputTokens: 0 });
    }
  });
});

describe("sdk model calls — provider cap errors", () => {
  it("maps provider quota failures to cap_reached instead of model_unavailable", async () => {
    aiMocks.generateObject.mockRejectedValueOnce({
      status: 429,
      message: "Anthropic rate limit exceeded",
    });

    const result = await calls.classify(resolved(), { prompt: "x", choices: ["a"] });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.tag).toBe("cap_reached");
      expect(result.error.message).toContain("cap_reached");
    }
  });

  it("maps other failures to model_unavailable", async () => {
    aiMocks.generateObject.mockRejectedValueOnce(new Error("connection refused"));

    const result = await calls.classify(resolved(), { prompt: "x", choices: ["a"] });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });

  it("yields a provider-cap-error part when the stream throws a quota failure", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: throwingParts([], { statusCode: 429, message: "quota exceeded" }),
      totalUsage: Promise.resolve({ totalTokens: 0 }),
    });

    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });

    expect(await collect(stream.parts)).toEqual([{ kind: "provider-cap-error" }]);
  });

  it("yields a provider-cap-error part for an in-stream provider cap error part", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([
        { type: "error", error: { status: 429, message: "rate limited" } },
        { type: "finish", finishReason: "error" },
      ]),
      totalUsage: Promise.resolve({ totalTokens: 0 }),
    });

    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });

    expect(await collect(stream.parts)).toEqual([
      { kind: "provider-cap-error" },
      { kind: "finish", finishReason: "error" },
    ]);
  });
});

describe("sdk model calls — stream translation", () => {
  it("maps SDK stream parts onto the intent-level part shape", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([
        { type: "text-delta", text: "hello" },
        { type: "tool-call", toolName: "write_skill" },
        { type: "tool-result", toolName: "write_skill", output: { ok: true } },
        { type: "error", error: "something broke" },
        { type: "finish", finishReason: "stop" },
      ]),
      totalUsage: Promise.resolve({ totalTokens: 5 }),
    });

    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });

    expect(await collect(stream.parts)).toEqual([
      { kind: "text", delta: "hello" },
      { kind: "tool-call", tool: "write_skill" },
      { kind: "tool-result", tool: "write_skill", output: { ok: true } },
      { kind: "error", message: "something broke" },
      { kind: "finish", finishReason: "stop" },
    ]);
  });

  it("settles usage() to SDK totals after a clean stream", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 31 }),
    });

    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });
    await collect(stream.parts);

    expect(await stream.usage()).toMatchObject({ inputTokens: 31 });
  });

  it("falls back to the latest in-stream usage when SDK totals are unavailable", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([
        { type: "text-delta", text: "partial", usage: { totalTokens: 9 } },
        { type: "text-delta", text: "unread", usage: { totalTokens: 20 } },
      ]),
      totalUsage: Promise.reject(new Error("aborted")),
    });

    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });
    // Consume one part, then stop — a consumer disconnect.
    await stream.parts.next();
    await stream.parts.return(undefined);

    expect(await stream.usage()).toMatchObject({ inputTokens: 9 });
  });
});

describe("sdk model calls — SDK translation", () => {
  it("forwards cache control on structured system prompts", async () => {
    aiMocks.streamText.mockReturnValueOnce({
      fullStream: parts([{ type: "finish", finishReason: "stop" }]),
      totalUsage: Promise.resolve({ totalTokens: 1 }),
    });

    const stream = calls.streamAgent(resolved(), {
      system: { content: "stable prefix", cacheControl: { type: "ephemeral", ttl: "5m" } },
      messages: [],
      tools: [],
    });
    await collect(stream.parts);

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

    const stream = calls.streamAgent(resolved(), {
      system: "",
      messages: [{ role: "user", content: "latest turn", cacheControl: { type: "ephemeral" } }],
      tools: [],
    });
    await collect(stream.parts);

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

    await calls.classify(resolved(), { prompt: "x", choices: ["a"] });
    await calls.runAgent(resolved(), { system: "", messages: [], tools: [] });
    const stream = calls.streamAgent(resolved(), { system: "", messages: [], tools: [] });
    await collect(stream.parts);
    await calls.generate(resolved(), {
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
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

    await calls.runAgent(resolved(), { system: "", messages: [], tools: [] });
    await calls.generate(resolved(), {
      system: "",
      prompt: "x",
      schema: z.object({ ok: z.boolean() }),
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

  it("adds no effort options off Sonnet", async () => {
    const generateText = aiMocks.generateText as Mock;
    generateText.mockResolvedValueOnce({ steps: [], usage: { totalTokens: 7 } });

    await calls.runAgent(resolved({ kind: "openai-compatible", modelId: "Hermes-4-405B" }), {
      system: "",
      messages: [],
      tools: [],
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.not.objectContaining({ providerOptions: expect.anything() }),
    );
  });

  it("flattens agent steps into the transcript shape", async () => {
    aiMocks.generateText.mockResolvedValueOnce({
      steps: [
        {
          text: "thinking",
          toolCalls: [{ toolName: "send_email", input: { to: "a@b.c" } }],
          toolResults: [{ toolName: "send_email", output: { sent: true } }],
        },
      ],
      usage: { totalTokens: 7 },
    } as never);

    const result = await calls.runAgent(resolved(), { system: "", messages: [], tools: [] });

    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.value.value.transcript).toEqual([
        { kind: "model", text: "thinking" },
        { kind: "tool-call", tool: "send_email", input: { to: "a@b.c" } },
        { kind: "tool-result", tool: "send_email", output: { sent: true } },
      ]);
    }
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
