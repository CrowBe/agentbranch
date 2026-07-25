import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GatewayTool } from "@/modules/model-gateway";
import type { ResolvedModel } from "@/modules/model-router";
import { isErr } from "@/shared";
import {
  createClaudeCodeModelCalls,
  type ClaudeCodeQuery,
} from "./claude-code-model-calls";

const resolved: ResolvedModel = {
  providerId: "claude-code-cli",
  kind: "claude-code-cli",
  structuredOutputs: "json-schema",
  modelId: "cli:claude-code",
  viaOverride: false,
};

function fakeQuery(
  messages: readonly unknown[],
  onParams?: (params: Parameters<ClaudeCodeQuery>[0]) => void,
): ClaudeCodeQuery {
  return (params) => {
    onParams?.(params);
    return {
      async *[Symbol.asyncIterator]() {
        for (const message of messages) yield message as SDKMessage;
      },
      close: vi.fn(),
    };
  };
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    stop_reason: "end_turn",
    structured_output: undefined,
    usage: {
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
    },
    modelUsage: {},
    permission_denials: [],
    ...overrides,
  };
}

describe("Claude Code model calls", () => {
  it("uses native schema output without passing the accounting sentinel as a model", async () => {
    let captured: Parameters<ClaudeCodeQuery>[0] | undefined;
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery(
        [successResult({ structured_output: { title: "Hello", count: 1 } })],
        (params) => { captured = params; },
      ),
    });

    const result = await calls.generate(resolved, {
      system: "Return a small object.",
      prompt: "Say hello.",
      schema: z.object({ title: z.string(), count: z.number() }),
    });

    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.value.value).toEqual({ title: "Hello", count: 1 });
    expect(result.value.usage).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 1,
    });
    expect(captured?.options?.model).toBeUndefined();
    expect(captured?.options?.tools).toEqual([]);
    expect(captured?.options?.settingSources).toEqual([]);
    expect(captured?.options?.cwd).toBe("/tmp");
    expect(captured?.options?.outputFormat).toMatchObject({ type: "json_schema" });
  });

  it("maps invalid structured output to model_unavailable", async () => {
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery([successResult({ structured_output: { count: "wrong" } })]),
    });
    const result = await calls.generate(resolved, {
      system: "Return an object.",
      prompt: "Return one.",
      schema: z.object({ count: z.number() }),
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.tag).toBe("model_unavailable");
  });

  it("folds assistant text, tool calls, and tool results into a transcript", async () => {
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery([
        {
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Calling echo." },
              {
                type: "tool_use",
                id: "tool-1",
                name: "mcp__gateway__echo",
                input: { value: "hello" },
              },
            ],
          },
        },
        {
          type: "user",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool-1",
                content: [{ type: "text", text: "{\"echoed\":\"hello\"}" }],
              },
            ],
          },
        },
        successResult(),
      ]),
    });
    const result = await calls.runAgent(resolved, {
      system: "Use echo.",
      messages: [{ role: "user", content: "Echo hello." }],
      tools: [echoTool()],
    });
    expect(isErr(result)).toBe(false);
    if (isErr(result)) return;
    expect(result.value.value.transcript).toEqual([
      { kind: "model", text: "Calling echo." },
      { kind: "tool-call", tool: "echo", input: { value: "hello" } },
      { kind: "tool-result", tool: "echo", output: { echoed: "hello" } },
    ]);
  });

  it("bridges only gateway tools and validates arguments before the handler", async () => {
    const handler = vi.fn(async ({ value }) => ({ echoed: value }));
    let captured: Parameters<ClaudeCodeQuery>[0] | undefined;
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery([successResult()], (params) => { captured = params; }),
    });
    await calls.runAgent(resolved, {
      system: "Use echo.",
      messages: [{ role: "user", content: "Echo." }],
      tools: [{ ...echoTool(), handler }],
    });

    expect(captured?.options?.tools).toEqual([]);
    expect(captured?.options?.strictMcpConfig).toBe(true);
    expect(captured?.options?.settingSources).toEqual([]);
    expect(captured?.options?.cwd).toBe("/tmp");
    expect(captured?.options?.allowedTools).toEqual(["mcp__gateway__echo"]);
    const server = captured?.options?.mcpServers?.gateway as unknown as {
      instance: {
        _registeredTools: Record<string, {
          inputSchema: { safeParse(input: unknown): { success: boolean; data?: unknown } };
          handler(args: unknown): Promise<unknown>;
        }>;
      };
    };
    const tool = server.instance._registeredTools.echo!;
    const invalidInput = tool.inputSchema.safeParse({});
    expect(invalidInput.success).toBe(false);
    const invalid = await tool.handler({});
    expect(invalid).toMatchObject({ isError: true });
    expect(handler).not.toHaveBeenCalled();
    const normalized = tool.inputSchema.safeParse({ value: "hello" });
    expect(normalized).toMatchObject({ success: true, data: { value: "hello" } });
    const valid = await tool.handler(normalized.data);
    expect(valid).toMatchObject({ content: [{ text: "{\"echoed\":\"hello\"}" }] });
    expect(handler).toHaveBeenCalledWith({ value: "hello" });
  });

  it("preserves nested unknown fields through MCP normalization for domain validation", async () => {
    const handler = vi.fn();
    let captured: Parameters<ClaudeCodeQuery>[0] | undefined;
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery([successResult()], (params) => { captured = params; }),
    });
    await calls.runAgent(resolved, {
      system: "Use submit.",
      messages: [{ role: "user", content: "Submit." }],
      tools: [{
        name: "submit",
        description: "Submits a nested payload.",
        parameters: {
          type: "object",
          properties: {
            payload: {
              type: "object",
              properties: { value: { type: "string" } },
              required: ["value"],
              additionalProperties: false,
            },
          },
          required: ["payload"],
          additionalProperties: false,
        },
        handler,
      }],
    });
    const server = captured?.options?.mcpServers?.gateway as unknown as {
      instance: {
        _registeredTools: Record<string, {
          inputSchema: {
            safeParse(input: unknown): { success: boolean; data?: Record<string, unknown> };
          };
          handler(args: unknown): Promise<unknown>;
        }>;
      };
    };
    const tool = server.instance._registeredTools.submit!;
    const raw = {
      payload: { value: "ok", nestedExtra: "must survive" },
      topExtra: "must survive",
    };
    const normalized = tool.inputSchema.safeParse(raw);
    expect(normalized).toMatchObject({ success: true, data: raw });
    const result = await tool.handler(normalized.data);
    expect(result).toMatchObject({
      isError: true,
      content: [{
        text: expect.stringContaining("unexpected property `topExtra`"),
      }],
    });
    expect(result).toMatchObject({
      content: [{
        text: expect.stringContaining("unexpected property `nestedExtra`"),
      }],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps partial text, tool events, finish, and usage for streams", async () => {
    const calls = createClaudeCodeModelCalls({
      query: fakeQuery([
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Hello" },
          },
        },
        {
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "tool_use", name: "mcp__gateway__echo" },
          },
        },
        successResult(),
      ]),
    });
    const stream = calls.streamAgent(resolved, {
      system: "Use echo.",
      messages: [{ role: "user", content: "Echo." }],
      tools: [echoTool()],
    });
    const parts = [];
    for await (const part of stream.parts) parts.push(part);
    expect(parts).toEqual([
      { kind: "text", delta: "Hello" },
      { kind: "tool-call", tool: "echo" },
      { kind: "finish", finishReason: "end_turn" },
    ]);
    expect((await stream.usage()).outputTokens).toBe(4);
  });
});

function echoTool(): GatewayTool {
  return {
    name: "echo",
    description: "Echoes a value.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    handler: ({ value }) => ({ echoed: value }),
  };
}
